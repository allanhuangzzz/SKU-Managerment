"""数据库初始化与连接管理（SQLite）"""
import sqlite3
from pathlib import Path

from flask import g

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "sku.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS countries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    code          TEXT NOT NULL,
    currency_code TEXT NOT NULL,
    sort_order    INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shipping_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    country_id  INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    channel     TEXT NOT NULL,
    cargo_type  TEXT NOT NULL,
    currency    TEXT NOT NULL,
    weight_min  REAL NOT NULL DEFAULT 0,
    weight_max  REAL,
    per_parcel  REAL NOT NULL DEFAULT 0,
    per_kg      REAL NOT NULL DEFAULT 0,
    remark      TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS products (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    sku               TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    category          TEXT DEFAULT '',
    cargo_type        TEXT DEFAULT '普货',
    length            REAL DEFAULT 0,
    width             REAL DEFAULT 0,
    height            REAL DEFAULT 0,
    purchase_price    REAL NOT NULL DEFAULT 0,
    domestic_shipping REAL NOT NULL DEFAULT 0,
    agent_fee         REAL NOT NULL DEFAULT 0,
    weight            REAL NOT NULL DEFAULT 0,
    remark            TEXT DEFAULT '',
    created_at        TEXT DEFAULT (datetime('now','localtime')),
    updated_at        TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS exchange_rates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    currency_code TEXT NOT NULL UNIQUE,
    rate_to_cny   REAL NOT NULL,
    source        TEXT DEFAULT 'manual',
    updated_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS commission_rates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    country_id  INTEGER NOT NULL UNIQUE REFERENCES countries(id) ON DELETE CASCADE,
    rate        REAL NOT NULL DEFAULT 13.0
);

CREATE TABLE IF NOT EXISTS product_selling_prices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    country_id    INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    channel       TEXT NOT NULL,
    selling_price REAL,
    UNIQUE(product_id, country_id, channel)
);"""

SEED_COUNTRIES = [
    ("美国", "US", "USD", 1),
    ("英国", "GB", "GBP", 2),
    ("德国", "DE", "EUR", 3),
    ("法国", "FR", "EUR", 4),
    ("意大利", "IT", "EUR", 5),
    ("西班牙", "ES", "EUR", 6),
    ("荷兰", "NL", "EUR", 7),
    ("加拿大", "CA", "CAD", 8),
    ("澳大利亚", "AU", "AUD", 9),
    ("日本", "JP", "JPY", 10),
    ("韩国", "KR", "KRW", 11),
    ("新加坡", "SG", "SGD", 12),
    ("马来西亚", "MY", "MYR", 13),
    ("泰国", "TH", "THB", 14),
    ("越南", "VN", "VND", 15),
    ("菲律宾", "PH", "PHP", 16),
    ("印度尼西亚", "ID", "IDR", 17),
    ("印度", "IN", "INR", 18),
    ("阿联酋", "AE", "AED", 19),
    ("沙特阿拉伯", "SA", "SAR", 20),
    ("俄罗斯", "RU", "RUB", 21),
    ("巴西", "BR", "BRL", 22),
    ("墨西哥", "MX", "MXN", 23),
    ("土耳其", "TR", "TRY", 24),
    ("波兰", "PL", "PLN", 25),
    ("中国香港", "HK", "HKD", 26),
    ("中国台湾", "TW", "TWD", 27),
    ("新西兰", "NZ", "NZD", 28),
]


def get_db():
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


def close_db(_e=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    if conn.execute("SELECT COUNT(*) FROM countries").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO countries (name, code, currency_code, sort_order) VALUES (?,?,?,?)",
            SEED_COUNTRIES,
        )
    # 迁移：旧表加新列
    for col, typ in (("cargo_type", "TEXT DEFAULT '普货'"), ("length", "REAL DEFAULT 0"), ("width", "REAL DEFAULT 0"), ("height", "REAL DEFAULT 0"), ("image_path", "TEXT DEFAULT ''"), ("link", "TEXT DEFAULT ''"), ("agent_fee", "REAL NOT NULL DEFAULT 0")):
        try:
            conn.execute(f"ALTER TABLE products ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass
    # 初始化佣金：德/西/法/意 15%，其余 13%
    if conn.execute("SELECT COUNT(*) FROM commission_rates").fetchone()[0] == 0:
        special = {3, 4, 5, 6}  # 德国, 法国, 意大利, 西班牙
        rows = conn.execute("SELECT id FROM countries").fetchall()
        for r in rows:
            rate = 15.0 if r["id"] in special else 13.0
            conn.execute("INSERT INTO commission_rates (country_id, rate) VALUES (?,?)", (r["id"], rate))
    conn.commit()
    conn.close()
