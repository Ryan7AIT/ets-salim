import hashlib
import json
import secrets
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from .invoice_service import (
        build_excel,
        build_pdf,
        create_invoice,
        default_invoice_settings,
        delete_invoice,
        get_invoice,
        invoices_enabled,
        list_invoices,
        load_invoice_settings,
        require_invoices_enabled,
        save_invoice_settings,
        update_invoice,
    )
    from .stock_service import (
        create_movement,
        create_product,
        delete_product,
        get_product,
        list_movements,
        list_products,
        require_stock_enabled,
        stock_enabled,
        update_product,
    )
    from .notification_service import (
        configure_sqlite_connection,
        load_notification_state,
        read_config_value,
        read_json_setting,
        sync_telegram_notifications,
        write_json_setting,
    )
except ImportError:
    from invoice_service import (
        build_excel,
        build_pdf,
        create_invoice,
        default_invoice_settings,
        delete_invoice,
        get_invoice,
        invoices_enabled,
        list_invoices,
        load_invoice_settings,
        require_invoices_enabled,
        save_invoice_settings,
        update_invoice,
    )
    from stock_service import (
        create_movement,
        create_product,
        delete_product,
        get_product,
        list_movements,
        list_products,
        require_stock_enabled,
        stock_enabled,
        update_product,
    )
    from notification_service import (
        configure_sqlite_connection,
        load_notification_state,
        read_config_value,
        read_json_setting,
        sync_telegram_notifications,
        write_json_setting,
    )


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


def parse_contract_quotas(raw: Any, contract: dict[str, Any] | None = None) -> dict[str, int]:
    contract = contract or {}
    if isinstance(raw, dict):
        if raw.get("chaudiereTotal") is not None or raw.get("bruleurTotal") is not None:
            return {
                "chaudiereTotal": max(0, int(raw.get("chaudiereTotal") or 0)),
                "bruleurTotal": max(0, int(raw.get("bruleurTotal") or 0)),
            }
        chaudiere_dates = unique_sorted_dates(list(raw.get("chaudiereDates") or raw.get("chaudiere") or []))
        bruleur_dates = unique_sorted_dates(list(raw.get("bruleurDates") or raw.get("bruleur") or []))
        return {
            "chaudiereTotal": len(chaudiere_dates),
            "bruleurTotal": len(bruleur_dates),
        }
    if isinstance(raw, list):
        return {"chaudiereTotal": len(unique_sorted_dates(raw)), "bruleurTotal": 0}
    if contract.get("chaudiereTotal") is not None or contract.get("bruleurTotal") is not None:
        return {
            "chaudiereTotal": max(0, int(contract.get("chaudiereTotal") or 0)),
            "bruleurTotal": max(0, int(contract.get("bruleurTotal") or 0)),
        }
    legacy_total = max(0, int(contract.get("total") or 0))
    return {"chaudiereTotal": legacy_total, "bruleurTotal": 0}


def serialize_contract_quotas(contract: dict[str, Any]) -> str:
    quotas = parse_contract_quotas(
        {
            "chaudiereTotal": contract.get("chaudiereTotal"),
            "bruleurTotal": contract.get("bruleurTotal"),
            "chaudiereDates": contract.get("chaudiereDates"),
            "bruleurDates": contract.get("bruleurDates"),
        }
        if contract.get("chaudiereTotal") is not None
        or contract.get("bruleurTotal") is not None
        or contract.get("chaudiereDates") is not None
        or contract.get("bruleurDates") is not None
        else contract.get("interventionDates", []),
        contract,
    )
    return json.dumps(quotas)


def contract_total_interventions(contract: dict[str, Any]) -> int:
    quotas = parse_contract_quotas(
        {
            "chaudiereTotal": contract.get("chaudiereTotal"),
            "bruleurTotal": contract.get("bruleurTotal"),
            "chaudiereDates": contract.get("chaudiereDates"),
            "bruleurDates": contract.get("bruleurDates"),
        }
        if contract.get("chaudiereTotal") is not None
        or contract.get("bruleurTotal") is not None
        or contract.get("chaudiereDates") is not None
        or contract.get("bruleurDates") is not None
        else contract.get("interventionDates", []),
        contract,
    )
    return quotas["chaudiereTotal"] + quotas["bruleurTotal"]


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
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    configure_sqlite_connection(conn)
    return conn


def read_state_from_conn(conn: sqlite3.Connection) -> dict[str, Any]:
    clients = [dict(row) for row in conn.execute("SELECT * FROM clients ORDER BY id")]
    contracts = []
    for row in conn.execute("SELECT * FROM contracts ORDER BY id"):
        item = dict(row)
        item["planningMode"] = item.pop("planning_mode")
        quotas = parse_contract_quotas(json.loads(item.pop("intervention_dates") or "[]"), item)
        item["chaudiereTotal"] = quotas["chaudiereTotal"]
        item["bruleurTotal"] = quotas["bruleurTotal"]
        item.pop("chaudiere_planning_mode", None)
        item.pop("bruleur_planning_mode", None)
        contracts.append(item)

    interventions = []
    for row in conn.execute("SELECT * FROM interventions ORDER BY date, id"):
        item = dict(row)
        item["contractId"] = item.pop("contract_id")
        item["type"] = item.get("type")
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
                address TEXT DEFAULT '',
                nif TEXT DEFAULT '',
                rc TEXT DEFAULT '',
                nis TEXT DEFAULT ''
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
                chaudiere_planning_mode TEXT DEFAULT 'auto',
                bruleur_planning_mode TEXT DEFAULT 'auto',
                intervention_dates TEXT NOT NULL DEFAULT '[]',
                notes TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS interventions (
                id TEXT PRIMARY KEY,
                client TEXT NOT NULL,
                contract_id INTEGER,
                type TEXT,
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
            CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                number TEXT NOT NULL UNIQUE,
                client_id INTEGER NOT NULL,
                issue_date TEXT NOT NULL,
                due_date TEXT DEFAULT '',
                document_type TEXT DEFAULT 'facture',
                include_cachet INTEGER DEFAULT 0,
                status TEXT DEFAULT 'draft',
                currency TEXT DEFAULT 'DZD',
                notes TEXT DEFAULT '',
                adjustment REAL DEFAULT 0,
                discount_amount REAL DEFAULT 0,
                tax_rate REAL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (client_id) REFERENCES clients(id)
            );
            CREATE TABLE IF NOT EXISTS invoice_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_id INTEGER NOT NULL,
                description TEXT NOT NULL,
                period TEXT DEFAULT '',
                quantity REAL DEFAULT 1,
                unit_price REAL DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
                FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS stock_products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                reference TEXT DEFAULT '',
                picture TEXT DEFAULT '',
                quantity REAL DEFAULT 0,
                buy_price REAL DEFAULT 0,
                sale_price REAL DEFAULT 0,
                low_stock_threshold REAL DEFAULT 0,
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS stock_movements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                quantity REAL NOT NULL,
                unit_price REAL DEFAULT 0,
                reason TEXT DEFAULT '',
                movement_date TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (product_id) REFERENCES stock_products(id) ON DELETE RESTRICT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_products_reference
                ON stock_products(reference)
                WHERE reference != '';
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

        contract_columns = {row[1] for row in conn.execute("PRAGMA table_info(contracts)")}
        if "chaudiere_planning_mode" not in contract_columns:
            conn.execute("ALTER TABLE contracts ADD COLUMN chaudiere_planning_mode TEXT DEFAULT 'auto'")
        if "bruleur_planning_mode" not in contract_columns:
            conn.execute("ALTER TABLE contracts ADD COLUMN bruleur_planning_mode TEXT DEFAULT 'auto'")

        intervention_columns = {row[1] for row in conn.execute("PRAGMA table_info(interventions)")}
        if "type" not in intervention_columns:
            conn.execute("ALTER TABLE interventions ADD COLUMN type TEXT")

        client_columns = {row[1] for row in conn.execute("PRAGMA table_info(clients)")}
        if "nif" not in client_columns:
            conn.execute("ALTER TABLE clients ADD COLUMN nif TEXT DEFAULT ''")
        if "rc" not in client_columns:
            conn.execute("ALTER TABLE clients ADD COLUMN rc TEXT DEFAULT ''")
        if "nis" not in client_columns:
            conn.execute("ALTER TABLE clients ADD COLUMN nis TEXT DEFAULT ''")

        invoice_columns = {row[1] for row in conn.execute("PRAGMA table_info(invoices)")}
        if "discount_amount" not in invoice_columns:
            conn.execute("ALTER TABLE invoices ADD COLUMN discount_amount REAL DEFAULT 0")
        if "document_type" not in invoice_columns:
            conn.execute("ALTER TABLE invoices ADD COLUMN document_type TEXT DEFAULT 'facture'")
        if "include_cachet" not in invoice_columns:
            conn.execute("ALTER TABLE invoices ADD COLUMN include_cachet INTEGER DEFAULT 0")


def read_state() -> dict[str, Any]:
    with db() as conn:
        return read_state_from_conn(conn)


def replace_state(conn: sqlite3.Connection, state: dict[str, Any]) -> None:
    conn.execute("DELETE FROM clients")
    conn.execute("DELETE FROM contracts")
    conn.execute("DELETE FROM interventions")

    for client in state.get("clients", []):
        conn.execute(
            "INSERT INTO clients (id, company, contact, phone, email, address, nif, rc, nis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                client["id"],
                client.get("company", ""),
                client.get("contact", ""),
                client.get("phone", ""),
                client.get("email", ""),
                client.get("address", ""),
                client.get("nif", ""),
                client.get("rc", ""),
                client.get("nis", ""),
            ),
        )

    for contract in state.get("contracts", []):
        conn.execute(
            """
            INSERT INTO contracts
            (id, name, client, start, end, total, status, planning_mode, chaudiere_planning_mode, bruleur_planning_mode, intervention_dates, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                contract["id"],
                contract.get("name", ""),
                contract.get("client", ""),
                contract.get("start", ""),
                contract.get("end", ""),
                int(contract.get("total") or contract_total_interventions(contract) or 1),
                contract.get("status", "Actif"),
                contract.get("planningMode", "auto"),
                contract.get("chaudierePlanningMode", contract.get("planningMode", "auto")),
                contract.get("bruleurPlanningMode", contract.get("planningMode", "auto")),
                serialize_contract_quotas(contract),
                contract.get("notes", ""),
            ),
        )

    for intervention in state.get("interventions", []):
        conn.execute(
            """
            INSERT INTO interventions
            (id, client, contract_id, type, date, priority, status, notes, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                intervention["id"],
                intervention.get("client", ""),
                intervention.get("contractId"),
                intervention.get("type"),
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


class InvoiceItemPayload(BaseModel):
    id: int | None = None
    description: str
    quantity: float = 1
    unitPrice: float = 0
    sortOrder: int = 0


class InvoicePayload(BaseModel):
    number: str | None = None
    clientId: int
    documentType: str = "facture"
    includeCachet: bool = False
    issueDate: str | None = None
    dueDate: str | None = None
    status: str = "draft"
    currency: str | None = None
    notes: str = ""
    adjustment: float = 0
    discountAmount: float = 0
    taxRate: float | None = None
    items: list[InvoiceItemPayload] = Field(default_factory=list)


class InvoiceSettingsPayload(BaseModel):
    companyName: str = ""
    contactName: str = ""
    address: str = ""
    email: str = ""
    phone: str = ""
    nif: str = ""
    registrationNumber: str = ""
    rip: str = ""
    logoMode: str = "text"
    logoText: str = ""
    logoImage: str = ""
    cachetImage: str = ""
    invoiceLanguage: str = "fr"
    defaultTaxRate: float = 20
    currency: str = "DZD"
    paymentTermsDays: int = 7
    footerNotes: str = ""


class StockProductPayload(BaseModel):
    name: str
    reference: str = ""
    picture: str = ""
    buyPrice: float = 0
    salePrice: float = 0
    lowStockThreshold: float = 0
    notes: str = ""
    initialQuantity: float = 0


class StockProductUpdatePayload(BaseModel):
    name: str
    reference: str = ""
    picture: str | None = None
    buyPrice: float | None = None
    salePrice: float | None = None
    lowStockThreshold: float | None = None
    notes: str | None = None


class StockMovementPayload(BaseModel):
    productId: int
    type: str
    quantity: float = 0
    newQuantity: float | None = None
    unitPrice: float = 0
    reason: str = ""
    movementDate: str | None = None


def feature_flags() -> dict[str, bool]:
    return {
        "invoices": invoices_enabled(read_config_value),
        "stock": stock_enabled(read_config_value),
    }


@app.on_event("startup")
def startup() -> None:
    init_db()
    with db() as conn:
        sync_telegram_notifications(DB_PATH, load_notification_state(conn))


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


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    return {"features": feature_flags()}


@app.get("/api/state")
def get_state(background_tasks: BackgroundTasks) -> dict[str, Any]:
    with db() as conn:
        state = read_state_from_conn(conn)
    background_tasks.add_task(sync_telegram_notifications, DB_PATH, state)
    return state


@app.put("/api/state")
def put_state(state: AppState, background_tasks: BackgroundTasks) -> dict[str, Any]:
    with db() as conn:
        replace_state(conn, state.model_dump())
        saved_state = read_state_from_conn(conn)
    background_tasks.add_task(sync_telegram_notifications, DB_PATH, saved_state)
    return saved_state


@app.get("/api/invoices")
def api_list_invoices() -> list[dict[str, Any]]:
    require_invoices_enabled(read_config_value)
    with db() as conn:
        return list_invoices(conn)


@app.post("/api/invoices")
def api_create_invoice(payload: InvoicePayload) -> dict[str, Any]:
    require_invoices_enabled(read_config_value)
    with db() as conn:
        return create_invoice(conn, payload.model_dump())


@app.get("/api/invoices/{invoice_id}")
def api_get_invoice(invoice_id: int) -> dict[str, Any]:
    require_invoices_enabled(read_config_value)
    with db() as conn:
        return get_invoice(conn, invoice_id)


@app.put("/api/invoices/{invoice_id}")
def api_update_invoice(invoice_id: int, payload: InvoicePayload) -> dict[str, Any]:
    require_invoices_enabled(read_config_value)
    with db() as conn:
        return update_invoice(conn, invoice_id, payload.model_dump())


@app.delete("/api/invoices/{invoice_id}")
def api_delete_invoice(invoice_id: int) -> dict[str, bool]:
    require_invoices_enabled(read_config_value)
    with db() as conn:
        delete_invoice(conn, invoice_id)
    return {"ok": True}


@app.get("/api/invoices/{invoice_id}/export.pdf")
def api_export_invoice_pdf(invoice_id: int) -> Response:
    require_invoices_enabled(read_config_value)
    with db() as conn:
        invoice = get_invoice(conn, invoice_id)
        settings = load_invoice_settings(conn)
        pdf_bytes = build_pdf(invoice, settings)
    filename = f"invoice-{invoice['number']}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/invoices/{invoice_id}/export.xlsx")
def api_export_invoice_xlsx(invoice_id: int) -> Response:
    require_invoices_enabled(read_config_value)
    with db() as conn:
        invoice = get_invoice(conn, invoice_id)
        settings = load_invoice_settings(conn)
        excel_bytes = build_excel(invoice, settings)
    filename = f"invoice-{invoice['number']}.xlsx"
    return Response(
        content=excel_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/invoice-settings")
def api_get_invoice_settings() -> dict[str, Any]:
    require_invoices_enabled(read_config_value)
    with db() as conn:
        return load_invoice_settings(conn)


@app.put("/api/invoice-settings")
def api_put_invoice_settings(payload: InvoiceSettingsPayload) -> dict[str, Any]:
    require_invoices_enabled(read_config_value)
    with db() as conn:
        return save_invoice_settings(conn, payload.model_dump())


@app.get("/api/stock/products")
def api_list_stock_products() -> dict[str, Any]:
    require_stock_enabled(read_config_value)
    with db() as conn:
        return list_products(conn)


@app.post("/api/stock/products")
def api_create_stock_product(payload: StockProductPayload) -> dict[str, Any]:
    require_stock_enabled(read_config_value)
    with db() as conn:
        return create_product(conn, payload.model_dump())


@app.get("/api/stock/products/{product_id}")
def api_get_stock_product(product_id: int) -> dict[str, Any]:
    require_stock_enabled(read_config_value)
    with db() as conn:
        return get_product(conn, product_id)


@app.put("/api/stock/products/{product_id}")
def api_update_stock_product(product_id: int, payload: StockProductUpdatePayload) -> dict[str, Any]:
    require_stock_enabled(read_config_value)
    with db() as conn:
        return update_product(conn, product_id, payload.model_dump())


@app.delete("/api/stock/products/{product_id}")
def api_delete_stock_product(product_id: int) -> dict[str, bool]:
    require_stock_enabled(read_config_value)
    with db() as conn:
        delete_product(conn, product_id)
    return {"ok": True}


@app.get("/api/stock/movements")
def api_list_stock_movements(
    product_id: int | None = None,
    type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict[str, Any]]:
    require_stock_enabled(read_config_value)
    with db() as conn:
        return list_movements(conn, product_id, type, date_from, date_to)


@app.post("/api/stock/movements")
def api_create_stock_movement(payload: StockMovementPayload) -> dict[str, Any]:
    require_stock_enabled(read_config_value)
    with db() as conn:
        return create_movement(conn, payload.model_dump())


@app.get("/")
def index() -> FileResponse:
    return FileResponse(ROOT_DIR / "index.html")


app.mount("/", StaticFiles(directory=ROOT_DIR, html=True), name="static")
