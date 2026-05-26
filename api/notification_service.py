import json
import logging
import os
import sqlite3
from pathlib import Path
from typing import Any

import requests


TELEGRAM_API_BASE_URL = "https://api.telegram.org"
TELEGRAM_BOT_TOKEN_ENV = "TELEGRAM_BOT_TOKEN"
TELEGRAM_CHAT_ID_ENV = "TELEGRAM_CHAT_ID"
TELEGRAM_SENT_STATUS_KEY = "notificationDeliverySentStatus"
TELEGRAM_REQUEST_TIMEOUT = 30
TELEGRAM_ENV_FILES = (
    Path(__file__).resolve().parents[1] / ".env",
    Path(__file__).with_name(".env"),
)

logger = logging.getLogger(__name__)
_telegram_config_warning_logged = False


def configure_sqlite_connection(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")


def open_db(db_path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    configure_sqlite_connection(conn)
    return conn


def read_json_setting(conn: sqlite3.Connection, key: str, default: Any) -> Any:
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except (TypeError, json.JSONDecodeError):
        return default


def write_json_setting(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
        (key, json.dumps(value)),
    )


def notification_days_text(diff: int) -> str:
    if diff == 0:
        return "aujourd'hui"
    if diff == 1:
        return "demain"
    return f"dans {diff} jour(s)"


def upcoming_notifications(state: dict[str, Any]) -> list[dict[str, str]]:
    from datetime import date

    today = date.today()
    limit = max(1, int(state.get("notifSettings", {}).get("daysBeforeIntervention", 3) or 3))
    notifications: list[dict[str, str]] = []

    for intervention in state.get("interventions", []):
        if intervention.get("status") in {"Terminé", "Annulé"}:
            continue

        try:
            intervention_date = date.fromisoformat(intervention.get("date", ""))
        except (TypeError, ValueError):
            continue

        diff = (intervention_date - today).days
        if diff < 0 or diff > limit:
            continue

        notifications.append(
            {
                "interventionId": intervention["id"],
                "date": intervention["date"],
                "message": (
                    f"Bonjour Lotfi, vouz avez une intervention chez {intervention.get('client', '')} "
                    f"prévue le {intervention['date']} ({notification_days_text(diff)})."
                ),
            }
        )

    notifications.sort(key=lambda item: (item["date"], item["interventionId"]))
    return notifications


def read_env_file_value(file_path: Path, key: str) -> str | None:
    if not file_path.exists():
        return None

    try:
        lines = file_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue

        current_key, current_value = line.split("=", 1)
        if current_key.strip() != key:
            continue

        value = current_value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"\"", "'"}:
            value = value[1:-1]
        return value or None

    return None


def read_config_value(key: str) -> str | None:
    value = os.getenv(key)
    if value:
        value = value.strip()
    if value:
        return value

    for env_file in TELEGRAM_ENV_FILES:
        file_value = read_env_file_value(env_file, key)
        if file_value:
            return file_value

    return None


def load_telegram_config() -> dict[str, str] | None:
    bot_token = read_config_value(TELEGRAM_BOT_TOKEN_ENV)
    chat_id = read_config_value(TELEGRAM_CHAT_ID_ENV)
    if not bot_token or not chat_id:
        return None
    return {"bot_token": bot_token, "chat_id": chat_id}


def telegram_notifications_configured() -> bool:
    return load_telegram_config() is not None


def log_missing_telegram_config_once() -> None:
    global _telegram_config_warning_logged

    if _telegram_config_warning_logged:
        return

    logger.warning(
        "Telegram notifications are not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the environment or the project .env file."
    )
    _telegram_config_warning_logged = True


def telegram_send_url(bot_token: str) -> str:
    return f"{TELEGRAM_API_BASE_URL}/bot{bot_token}/sendMessage"


def send_telegram_message(text: str, telegram_config: dict[str, str] | None = None) -> bool:
    telegram_config = telegram_config or load_telegram_config()
    if not telegram_config:
        log_missing_telegram_config_once()
        return False

    try:
        response = requests.post(
            telegram_send_url(telegram_config["bot_token"]),
            json={"chat_id": telegram_config["chat_id"], "text": text},
            timeout=TELEGRAM_REQUEST_TIMEOUT,
        )
    except requests.RequestException:
        logger.error("Unable to reach the Telegram API.")
        return False

    if not response.ok:
        logger.error("Telegram API returned HTTP %s while sending a notification.", response.status_code)
        return False

    try:
        payload = response.json()
    except ValueError:
        logger.error("Telegram API returned an invalid JSON response.")
        return False

    if not payload.get("ok", False):
        logger.error(
            "Telegram API rejected the notification: %s",
            payload.get("description", "unknown error"),
        )
        return False

    return True


def sync_telegram_notifications(
    db_path: str | Path,
    state: dict[str, Any],
) -> dict[str, int]:
    """Send pending Telegram alerts without holding a DB connection during HTTP calls."""
    db_path = Path(db_path)
    notifications = upcoming_notifications(state)
    active_signatures = {
        item["interventionId"]: f"{item['date']}|{item['message']}" for item in notifications
    }
    telegram_config = load_telegram_config()

    with open_db(db_path) as conn:
        sent_status = read_json_setting(conn, TELEGRAM_SENT_STATUS_KEY, {})

    next_sent_status = {
        intervention_id: signature
        for intervention_id, signature in sent_status.items()
        if intervention_id in active_signatures
    }

    sent_count = 0
    for notification in notifications:
        intervention_id = notification["interventionId"]
        signature = active_signatures[intervention_id]
        if next_sent_status.get(intervention_id) == signature:
            continue
        if send_telegram_message(notification["message"], telegram_config):
            next_sent_status[intervention_id] = signature
            sent_count += 1

    with open_db(db_path) as conn:
        write_json_setting(conn, TELEGRAM_SENT_STATUS_KEY, next_sent_status)
        conn.commit()

    return {
        "checked_notifications": len(notifications),
        "sent_notifications": sent_count,
    }


def load_notification_state(conn: sqlite3.Connection) -> dict[str, Any]:
    interventions = []
    for row in conn.execute("SELECT * FROM interventions ORDER BY date, id"):
        item = dict(row)
        item["contractId"] = item.pop("contract_id")
        interventions.append(item)

    return {
        "interventions": interventions,
        "notifSettings": read_json_setting(conn, "notifSettings", {"daysBeforeIntervention": 3}),
    }


def notification_tables_ready(conn: sqlite3.Connection) -> bool:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('interventions', 'app_settings')"
    ).fetchall()
    return {row["name"] for row in rows} == {"interventions", "app_settings"}


def sync_telegram_notifications_for_db(db_path: str | Path) -> dict[str, Any]:
    db_path = Path(db_path)
    if not db_path.exists():
        return {"status": "db_not_initialized", "checked_notifications": 0, "sent_notifications": 0}

    if not telegram_notifications_configured():
        return {"status": "telegram_not_configured", "checked_notifications": 0, "sent_notifications": 0}

    with open_db(db_path) as conn:
        if not notification_tables_ready(conn):
            return {"status": "db_not_initialized", "checked_notifications": 0, "sent_notifications": 0}
        state = load_notification_state(conn)

    result = sync_telegram_notifications(db_path, state)
    return {"status": "ok", **result}
