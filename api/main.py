import hashlib
import json
import secrets
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from .notification_service import read_json_setting, sync_whatsapp_notifications, write_json_setting
except ImportError:
    from notification_service import read_json_setting, sync_whatsapp_notifications, write_json_setting


ROOT_DIR = Path(__file__).resolve().parents[1]
DB_PATH = Path(__file__).with_name("plombtrack.sqlite3")
CURRENT_DATA_YEAR = 2026


app = FastAPI(title="PlombTrack API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def format_date(value: str | None) -> str:
    return value or ""


def add_days(date_string: str, days: int) -> str:
    from datetime import date, timedelta

    year, month, day = [int(part) for part in date_string.split("-")]
    return (date(year, month, day) + timedelta(days=days)).isoformat()


def unique_sorted_dates(values: list[str]) -> list[str]:
    return sorted(set(values))


def generate_automatic_dates(start: str, end: str, total: int) -> list[str]:
    from datetime import date

    count = int(total or 0)
    if not start or count <= 0:
        return []
    if count == 1:
        return [start]

    start_date = date.fromisoformat(start)
    end_date = date.fromisoformat(end or start)
    range_days = max(0, (end_date - start_date).days)

    if range_days == 0:
        return [add_days(start, index * 7) for index in range(count)]

    dates: list[str] = []
    previous_offset = -1
    for index in range(count):
        offset = round((range_days * index) / (count - 1))
        if offset <= previous_offset:
            offset = previous_offset + 1
        dates.append(add_days(start, offset))
        previous_offset = offset
    return unique_sorted_dates(dates)


def default_intervention_status(date_value: str) -> str:
    from datetime import date

    try:
        intervention_date = date.fromisoformat(date_value)
    except ValueError:
        return "Planifi\u00e9"
    return "Termin\u00e9" if intervention_date < date.today() else "Planifi\u00e9"


def create_default_clients() -> list[dict[str, Any]]:
    return [
    ]


def create_default_contracts() -> list[dict[str, Any]]:
    return [
    ]


def create_default_interventions(contracts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    priorities = ["Moyenne", "\u00c9lev\u00e9e", "Faible"]
    items: list[dict[str, Any]] = []
    for contract in contracts:
        for index, date_value in enumerate(contract["interventionDates"]):
            items.append(
                {
                    "id": f"INT-{contract['id']}{str(index + 1).zfill(2)}",
                    "client": contract["client"],
                    "contractId": contract["id"],
                    "date": date_value,
                    "priority": priorities[index % 3],
                    "status": default_intervention_status(date_value),
                    "notes": "",
                    "source": "contract",
                }
            )
    return items


def default_state() -> dict[str, Any]:
    return {
        "clients": create_default_clients(),
        "contracts": [],
        "interventions": [],
        "notifSettings": {"daysBeforeIntervention": 3},
        "notifReadStatus": {},
    }


def password_hash(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return salt, digest.hex()


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def read_state_from_conn(conn: sqlite3.Connection) -> dict[str, Any]:
    clients = [dict(row) for row in conn.execute("SELECT * FROM clients ORDER BY id")]
    contracts = []
    for row in conn.execute("SELECT * FROM contracts ORDER BY id"):
        item = dict(row)
        item["planningMode"] = item.pop("planning_mode")
        item["interventionDates"] = json.loads(item.pop("intervention_dates") or "[]")
        contracts.append(item)

    interventions = []
    for row in conn.execute("SELECT * FROM interventions ORDER BY date, id"):
        item = dict(row)
        item["contractId"] = item.pop("contract_id")
        interventions.append(item)

    return {
        "clients": clients,
        "contracts": contracts,
        "interventions": interventions,
        "notifSettings": read_json_setting(conn, "notifSettings", {"daysBeforeIntervention": 3}),
        "notifReadStatus": read_json_setting(conn, "notifReadStatus", {}),
    }


def init_db() -> None:
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY,
                company TEXT NOT NULL,
                contact TEXT NOT NULL,
                phone TEXT DEFAULT '',
                email TEXT DEFAULT '',
                address TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS contracts (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                client TEXT NOT NULL,
                start TEXT DEFAULT '',
                end TEXT DEFAULT '',
                total INTEGER DEFAULT 1,
                status TEXT DEFAULT 'Actif',
                planning_mode TEXT DEFAULT 'auto',
                intervention_dates TEXT NOT NULL DEFAULT '[]',
                notes TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS interventions (
                id TEXT PRIMARY KEY,
                client TEXT NOT NULL,
                contract_id INTEGER,
                date TEXT NOT NULL,
                priority TEXT DEFAULT 'Moyenne',
                status TEXT DEFAULT 'Planifié',
                notes TEXT DEFAULT '',
                source TEXT
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )

        if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            salt, hashed = password_hash("admin")
            conn.execute(
                "INSERT INTO users (username, password_salt, password_hash) VALUES (?, ?, ?)",
                ("admin", salt, hashed),
            )

        if conn.execute("SELECT COUNT(*) FROM clients").fetchone()[0] == 0:
            replace_state(conn, default_state())


def read_state() -> dict[str, Any]:
    with db() as conn:
        return read_state_from_conn(conn)


def replace_state(conn: sqlite3.Connection, state: dict[str, Any]) -> None:
    conn.execute("DELETE FROM clients")
    conn.execute("DELETE FROM contracts")
    conn.execute("DELETE FROM interventions")

    for client in state.get("clients", []):
        conn.execute(
            "INSERT INTO clients (id, company, contact, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)",
            (
                client["id"],
                client.get("company", ""),
                client.get("contact", ""),
                client.get("phone", ""),
                client.get("email", ""),
                client.get("address", ""),
            ),
        )

    for contract in state.get("contracts", []):
        conn.execute(
            """
            INSERT INTO contracts
            (id, name, client, start, end, total, status, planning_mode, intervention_dates, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                contract["id"],
                contract.get("name", ""),
                contract.get("client", ""),
                contract.get("start", ""),
                contract.get("end", ""),
                int(contract.get("total") or len(contract.get("interventionDates", [])) or 1),
                contract.get("status", "Actif"),
                contract.get("planningMode", "auto"),
                json.dumps(contract.get("interventionDates", [])),
                contract.get("notes", ""),
            ),
        )

    for intervention in state.get("interventions", []):
        conn.execute(
            """
            INSERT INTO interventions
            (id, client, contract_id, date, priority, status, notes, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                intervention["id"],
                intervention.get("client", ""),
                intervention.get("contractId"),
                intervention.get("date", ""),
                intervention.get("priority", "Moyenne"),
                intervention.get("status", "Planifi\u00e9"),
                intervention.get("notes", ""),
                intervention.get("source"),
            ),
        )

    write_json_setting(conn, "notifSettings", state.get("notifSettings", {"daysBeforeIntervention": 3}))
    write_json_setting(conn, "notifReadStatus", state.get("notifReadStatus", {}))


class LoginPayload(BaseModel):
    username: str
    password: str


class AppState(BaseModel):
    clients: list[dict[str, Any]] = Field(default_factory=list)
    contracts: list[dict[str, Any]] = Field(default_factory=list)
    interventions: list[dict[str, Any]] = Field(default_factory=list)
    notifSettings: dict[str, Any] = Field(default_factory=dict)
    notifReadStatus: dict[str, bool] = Field(default_factory=dict)


@app.on_event("startup")
def startup() -> None:
    init_db()
    with db() as conn:
        sync_whatsapp_notifications(conn, read_state_from_conn(conn))


@app.post("/api/login")
def login(payload: LoginPayload) -> dict[str, Any]:
    with db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = ?", (payload.username,)).fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    _, hashed = password_hash(payload.password, user["password_salt"])
    if not secrets.compare_digest(hashed, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return {"ok": True, "user": {"id": user["id"], "username": user["username"]}}


@app.get("/api/state")
def get_state() -> dict[str, Any]:
    with db() as conn:
        state = read_state_from_conn(conn)
        sync_whatsapp_notifications(conn, state)
        return state


@app.put("/api/state")
def put_state(state: AppState) -> dict[str, Any]:
    with db() as conn:
        replace_state(conn, state.model_dump())
        saved_state = read_state_from_conn(conn)
        sync_whatsapp_notifications(conn, saved_state)
        return saved_state


@app.get("/")
def index() -> FileResponse:
    return FileResponse(ROOT_DIR / "index.html")


app.mount("/", StaticFiles(directory=ROOT_DIR, html=True), name="static")
