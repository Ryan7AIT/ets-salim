"""Stock CRUD and movement helpers."""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timezone
from typing import Any

from fastapi import HTTPException

STOCK_ENABLED_ENV = "STOCK_ENABLED"
MOVEMENT_TYPES = {"in", "out", "adjustment"}


def env_flag_enabled(value: str | None) -> bool:
    if not value:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def stock_enabled(read_config_value) -> bool:
    return env_flag_enabled(read_config_value(STOCK_ENABLED_ENV))


def require_stock_enabled(read_config_value) -> None:
    if not stock_enabled(read_config_value):
        raise HTTPException(status_code=404, detail="Stock module is not enabled")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def today_iso() -> str:
    return date.today().isoformat()


def serialize_product(row: sqlite3.Row) -> dict[str, Any]:
    quantity = float(row["quantity"] or 0)
    buy_price = float(row["buy_price"] or 0)
    threshold = float(row["low_stock_threshold"] or 0)
    is_low_stock = threshold > 0 and quantity <= threshold
    return {
        "id": row["id"],
        "name": row["name"],
        "reference": row["reference"] or "",
        "picture": row["picture"] or "",
        "quantity": quantity,
        "buyPrice": buy_price,
        "salePrice": float(row["sale_price"] or 0),
        "lowStockThreshold": threshold,
        "notes": row["notes"] or "",
        "stockValue": round(quantity * buy_price, 2),
        "isLowStock": is_low_stock,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def serialize_movement(row: sqlite3.Row, product_name: str | None = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "productId": row["product_id"],
        "productName": product_name or row["product_name"] if "product_name" in row.keys() else "",
        "type": row["type"],
        "quantity": float(row["quantity"] or 0),
        "unitPrice": float(row["unit_price"] or 0),
        "reason": row["reason"] or "",
        "movementDate": row["movement_date"],
        "createdAt": row["created_at"],
    }


def ensure_product_exists(conn: sqlite3.Connection, product_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM stock_products WHERE id = ?", (product_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    return row


def ensure_unique_reference(conn: sqlite3.Connection, reference: str, exclude_id: int | None = None) -> None:
    ref = (reference or "").strip()
    if not ref:
        return
    query = "SELECT id FROM stock_products WHERE reference = ?"
    params: list[Any] = [ref]
    if exclude_id is not None:
        query += " AND id != ?"
        params.append(exclude_id)
    existing = conn.execute(query, params).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail="A product with this reference already exists")


def compute_stock_summary(products: list[dict[str, Any]]) -> dict[str, Any]:
    total_products = len(products)
    low_stock_count = sum(1 for product in products if product.get("isLowStock"))
    total_value = round(sum(float(product.get("stockValue") or 0) for product in products), 2)
    return {
        "totalProducts": total_products,
        "lowStockCount": low_stock_count,
        "totalStockValue": total_value,
    }


def list_products(conn: sqlite3.Connection) -> dict[str, Any]:
    rows = conn.execute("SELECT * FROM stock_products ORDER BY name COLLATE NOCASE, id").fetchall()
    products = [serialize_product(row) for row in rows]
    return {
        "products": products,
        "summary": compute_stock_summary(products),
    }


def get_product(conn: sqlite3.Connection, product_id: int, movement_limit: int = 20) -> dict[str, Any]:
    row = ensure_product_exists(conn, product_id)
    product = serialize_product(row)
    movement_rows = conn.execute(
        """
        SELECT m.*, p.name AS product_name
        FROM stock_movements m
        JOIN stock_products p ON p.id = m.product_id
        WHERE m.product_id = ?
        ORDER BY m.movement_date DESC, m.id DESC
        LIMIT ?
        """,
        (product_id, movement_limit),
    ).fetchall()
    product["recentMovements"] = [serialize_movement(item) for item in movement_rows]
    return product


def create_product(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Product name is required")

    reference = (payload.get("reference") or "").strip()
    ensure_unique_reference(conn, reference)

    initial_quantity = max(0.0, float(payload.get("initialQuantity") or 0))
    buy_price = max(0.0, float(payload.get("buyPrice") or 0))
    sale_price = max(0.0, float(payload.get("salePrice") or 0))
    threshold = max(0.0, float(payload.get("lowStockThreshold") or 0))
    now = utc_now_iso()

    cursor = conn.execute(
        """
        INSERT INTO stock_products
        (name, reference, picture, quantity, buy_price, sale_price, low_stock_threshold, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            reference,
            payload.get("picture") or "",
            initial_quantity,
            buy_price,
            sale_price,
            threshold,
            payload.get("notes") or "",
            now,
            now,
        ),
    )
    product_id = int(cursor.lastrowid)

    if initial_quantity > 0:
        conn.execute(
            """
            INSERT INTO stock_movements
            (product_id, type, quantity, unit_price, reason, movement_date, created_at)
            VALUES (?, 'in', ?, ?, ?, ?, ?)
            """,
            (
                product_id,
                initial_quantity,
                buy_price,
                "Stock initial",
                today_iso(),
                now,
            ),
        )

    return get_product(conn, product_id)


def update_product(conn: sqlite3.Connection, product_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    row = ensure_product_exists(conn, product_id)
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Product name is required")

    reference = (payload.get("reference") or "").strip()
    ensure_unique_reference(conn, reference, exclude_id=product_id)

    conn.execute(
        """
        UPDATE stock_products
        SET name = ?, reference = ?, picture = ?, buy_price = ?, sale_price = ?,
            low_stock_threshold = ?, notes = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            name,
            reference,
            payload.get("picture") if payload.get("picture") is not None else row["picture"],
            max(0.0, float(payload.get("buyPrice") if payload.get("buyPrice") is not None else row["buy_price"] or 0)),
            max(0.0, float(payload.get("salePrice") if payload.get("salePrice") is not None else row["sale_price"] or 0)),
            max(0.0, float(payload.get("lowStockThreshold") if payload.get("lowStockThreshold") is not None else row["low_stock_threshold"] or 0)),
            payload.get("notes") if payload.get("notes") is not None else row["notes"],
            utc_now_iso(),
            product_id,
        ),
    )
    return get_product(conn, product_id)


def delete_product(conn: sqlite3.Connection, product_id: int) -> None:
    ensure_product_exists(conn, product_id)
    movement_count = conn.execute(
        "SELECT COUNT(*) FROM stock_movements WHERE product_id = ?",
        (product_id,),
    ).fetchone()[0]
    if movement_count:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a product that has stock movements",
        )
    conn.execute("DELETE FROM stock_products WHERE id = ?", (product_id,))


def list_movements(
    conn: sqlite3.Connection,
    product_id: int | None = None,
    movement_type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict[str, Any]]:
    query = """
        SELECT m.*, p.name AS product_name
        FROM stock_movements m
        JOIN stock_products p ON p.id = m.product_id
        WHERE 1 = 1
    """
    params: list[Any] = []

    if product_id is not None:
        query += " AND m.product_id = ?"
        params.append(product_id)
    if movement_type:
        if movement_type not in MOVEMENT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid movement type")
        query += " AND m.type = ?"
        params.append(movement_type)
    if date_from:
        query += " AND m.movement_date >= ?"
        params.append(date_from)
    if date_to:
        query += " AND m.movement_date <= ?"
        params.append(date_to)

    query += " ORDER BY m.movement_date DESC, m.id DESC"
    rows = conn.execute(query, params).fetchall()
    return [serialize_movement(row) for row in rows]


def apply_movement_quantity(product_row: sqlite3.Row, movement_type: str, quantity: float, new_quantity: float | None) -> float:
    current = float(product_row["quantity"] or 0)

    if movement_type == "in":
        return current + quantity
    if movement_type == "out":
        next_quantity = current - quantity
        if next_quantity < 0:
            raise HTTPException(status_code=400, detail="Insufficient stock for this movement")
        return next_quantity
    if movement_type == "adjustment":
        if new_quantity is None:
            raise HTTPException(status_code=400, detail="New quantity is required for adjustment")
        if new_quantity < 0:
            raise HTTPException(status_code=400, detail="Quantity cannot be negative")
        return new_quantity

    raise HTTPException(status_code=400, detail="Invalid movement type")


def movement_delta(product_row: sqlite3.Row, movement_type: str, quantity: float, new_quantity: float | None) -> float:
    current = float(product_row["quantity"] or 0)
    if movement_type == "in":
        return quantity
    if movement_type == "out":
        return quantity
    if movement_type == "adjustment":
        target = float(new_quantity or 0)
        return abs(target - current)
    return quantity


def create_movement(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    product_id = int(payload.get("productId") or 0)
    if not product_id:
        raise HTTPException(status_code=400, detail="Product is required")

    movement_type = (payload.get("type") or "").strip().lower()
    if movement_type not in MOVEMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid movement type")

    product_row = ensure_product_exists(conn, product_id)
    new_quantity = payload.get("newQuantity")
    new_quantity_value = float(new_quantity) if new_quantity is not None else None

    if movement_type == "adjustment":
        if new_quantity_value is None:
            raise HTTPException(status_code=400, detail="New quantity is required for adjustment")
        quantity = movement_delta(product_row, movement_type, 0, new_quantity_value)
        if quantity == 0:
            raise HTTPException(status_code=400, detail="Adjustment quantity must be different from current stock")
    else:
        quantity = float(payload.get("quantity") or 0)
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be greater than zero")

    next_quantity = apply_movement_quantity(product_row, movement_type, quantity, new_quantity_value)
    movement_date = (payload.get("movementDate") or "").strip() or today_iso()
    unit_price = max(0.0, float(payload.get("unitPrice") or 0))
    reason = (payload.get("reason") or "").strip()
    now = utc_now_iso()

    cursor = conn.execute(
        """
        INSERT INTO stock_movements
        (product_id, type, quantity, unit_price, reason, movement_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            product_id,
            movement_type,
            quantity,
            unit_price,
            reason,
            movement_date,
            now,
        ),
    )
    conn.execute(
        "UPDATE stock_products SET quantity = ?, updated_at = ? WHERE id = ?",
        (next_quantity, now, product_id),
    )

    movement_id = int(cursor.lastrowid)
    row = conn.execute(
        """
        SELECT m.*, p.name AS product_name
        FROM stock_movements m
        JOIN stock_products p ON p.id = m.product_id
        WHERE m.id = ?
        """,
        (movement_id,),
    ).fetchone()
    return serialize_movement(row)
