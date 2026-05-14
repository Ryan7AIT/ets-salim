import json
import logging
import sqlite3
from pathlib import Path
from typing import Any

import requests


WHATSAPP_API_URL = "http://localhost:3000/api/sendText"
WHATSAPP_API_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-Api-Key": "9fe3e041c7b94367ad1a830572deb7fb",
}
WHATSAPP_CHAT_ID = "213549398688@c.us"
WHATSAPP_SESSION = "default"
WHATSAPP_SENT_STATUS_KEY = "whatsappNotifSentStatus"

logger = logging.getLogger(__name__)


def open_db(db_path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
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
                    f"Intervention chez {intervention.get('client', '')} "
                    f"prévue le {intervention['date']} ({notification_days_text(diff)})."
                ),
            }
        )

    notifications.sort(key=lambda item: (item["date"], item["interventionId"]))
    return notifications


def send_whatsapp_message(text: str) -> bool:
    try:
        response = requests.post(
            WHATSAPP_API_URL,
            json={"chatId": WHATSAPP_CHAT_ID, "text": text, "session": WHATSAPP_SESSION},
            headers=WHATSAPP_API_HEADERS,
            timeout=10,
        )
        response.raise_for_status()
        return True
    except requests.RequestException:
        logger.exception("Unable to send WhatsApp notification.")
        return False


def sync_whatsapp_notifications(
    conn: sqlite3.Connection,
    state: dict[str, Any],
) -> dict[str, int]:
    notifications = upcoming_notifications(state)
    active_signatures = {
        item["interventionId"]: f"{item['date']}|{item['message']}" for item in notifications
    }
    sent_status = read_json_setting(conn, WHATSAPP_SENT_STATUS_KEY, {})
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
        if send_whatsapp_message(notification["message"]):
            next_sent_status[intervention_id] = signature
            sent_count += 1

    write_json_setting(conn, WHATSAPP_SENT_STATUS_KEY, next_sent_status)
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


def sync_whatsapp_notifications_for_db(db_path: str | Path) -> dict[str, Any]:
    db_path = Path(db_path)
    if not db_path.exists():
        return {"status": "db_not_initialized", "checked_notifications": 0, "sent_notifications": 0}

    with open_db(db_path) as conn:
        if not notification_tables_ready(conn):
            return {"status": "db_not_initialized", "checked_notifications": 0, "sent_notifications": 0}

        result = sync_whatsapp_notifications(conn, load_notification_state(conn))
        return {"status": "ok", **result}
