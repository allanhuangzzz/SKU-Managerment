"""产品SKU管理系统 - Flask 后端"""
import json
import os
import sqlite3
import threading
import time
import urllib.request
from datetime import datetime

from flask import Flask, jsonify, render_template, request

import db

app = Flask(__name__)
app.json.ensure_ascii = False
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.teardown_appcontext(db.close_db)

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "static", "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# 实时汇率免费接口（主接口失败时自动降级到备用接口）
RATE_PRIMARY = "https://open.er-api.com/v6/latest/USD"
RATE_FALLBACK = "https://api.frankfurter.app/latest?from=CNY"
STALE_HOURS = 6  # 超过该时长视为汇率过期

CURRENCY_SYMBOLS = {
    "CNY": "¥", "USD": "$", "EUR": "€", "GBP": "£",
    "PLN": "zł", "CZK": "Kč", "HUF": "Ft", "JPY": "¥",
    "KRW": "₩", "THB": "฿", "SGD": "S$", "MYR": "RM",
    "IDR": "Rp", "VND": "₫", "PHP": "₱", "INR": "₹",
    "AUD": "A$", "CAD": "C$", "NZD": "NZ$", "CHF": "CHF",
    "SEK": "kr", "NOK": "kr", "DKK": "kr", "MXN": "MX$",
    "BRL": "R$", "TWD": "NT$", "AED": "د.إ",
}


# ---------- 工具函数 ----------

def _num(value, default=0.0):
    """安全转换为 float"""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _fetch_live_rates():
    """获取实时汇率，返回 {币种: 1外币兑换人民币} 与数据来源，失败返回 ({}, None)"""
    def _get(url):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            return json.loads(resp.read().decode("utf-8"))

    # 主接口：以美元为基准，通过交叉汇率换算为兑人民币
    try:
        data = _get(RATE_PRIMARY)
        if data.get("result") == "success" and data.get("rates"):
            rates = data["rates"]
            if "CNY" in rates:
                cny = rates["CNY"]
                return {c: round(cny / v, 6) for c, v in rates.items()}, "open.er-api.com"
    except Exception:
        pass
    # 备用接口：直接以人民币为基准
    try:
        data = _get(RATE_FALLBACK)
        rates = data.get("rates")
        if rates:
            return {c: round(v, 6) for c, v in rates.items()}, "frankfurter.app"
    except Exception:
        pass
    return {}, None


def _apply_rate_for_currency(dbconn, currency, live_rates, source="auto"):
    """为单个币种写入/更新汇率，返回是否成功"""
    rate = live_rates.get(currency)
    if rate is None:
        return False
    now = _now()
    dbconn.execute(
        """INSERT INTO exchange_rates (currency_code, rate_to_cny, source, updated_at)
           VALUES (?,?,?,?)
           ON CONFLICT(currency_code) DO UPDATE SET rate_to_cny=?, source=?, updated_at=?""",
        (currency, rate, source, now, rate, source, now),
    )
    return True


def _upsert_rate(dbconn, currency, rate, source):
    now = _now()
    dbconn.execute(
        """INSERT INTO exchange_rates (currency_code, rate_to_cny, source, updated_at)
           VALUES (?,?,?,?)
           ON CONFLICT(currency_code) DO UPDATE SET rate_to_cny=?, source=?, updated_at=?""",
        (currency, rate, source, now, rate, source, now),
    )


def _last_auto_update(dbconn):
    row = dbconn.execute(
        "SELECT MAX(updated_at) AS t FROM exchange_rates WHERE source='auto'"
    ).fetchone()
    return row["t"] if row and row["t"] else None


def _refresh_all_rates(dbconn, live_rates, source="auto"):
    """为所有国家币种批量刷新汇率，返回更新数量"""
    currencies = [
        r["currency_code"]
        for r in dbconn.execute("SELECT DISTINCT currency_code FROM countries")
    ]
    updated = 0
    for c in currencies:
        if _apply_rate_for_currency(dbconn, c, live_rates, source):
            updated += 1
    return updated


# ---------- 页面 ----------

@app.get("/")
def index():
    return render_template("index.html")


# ---------- 产品信息 ----------

@app.get("/api/products")
def list_products():
    rows = db.get_db().execute("SELECT * FROM products ORDER BY updated_at DESC, id DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/products")
def create_product():
    data = request.get_json(silent=True) or {}
    sku = (data.get("sku") or "").strip()
    name = (data.get("name") or "").strip()
    if not sku or not name:
        return jsonify({"ok": False, "message": "SKU 与产品名称不能为空"}), 400
    dbconn = db.get_db()
    try:
        cur = dbconn.execute(
            """INSERT INTO products (sku, name, category, cargo_type, length, width, height,
               purchase_price, domestic_shipping, weight, link, remark)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                sku,
                name,
                (data.get("category") or "").strip(),
                (data.get("cargo_type") or "普货").strip(),
                _num(data.get("length")),
                _num(data.get("width")),
                _num(data.get("height")),
                _num(data.get("purchase_price")),
                _num(data.get("domestic_shipping")),
                _num(data.get("weight")),
                (data.get("link") or "").strip(),
                (data.get("remark") or "").strip(),
            ),
        )
        dbconn.commit()
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "message": f"SKU 已存在：{sku}"}), 400
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.put("/api/products/<int:pid>")
def update_product(pid):
    data = request.get_json(silent=True) or {}
    sku = (data.get("sku") or "").strip()
    name = (data.get("name") or "").strip()
    if not sku or not name:
        return jsonify({"ok": False, "message": "SKU 与产品名称不能为空"}), 400
    dbconn = db.get_db()
    if dbconn.execute("SELECT id FROM products WHERE id=?", (pid,)).fetchone() is None:
        return jsonify({"ok": False, "message": "产品不存在"}), 404
    try:
        dbconn.execute(
            """UPDATE products SET sku=?, name=?, category=?, cargo_type=?, length=?, width=?, height=?,
               purchase_price=?, domestic_shipping=?, weight=?, link=?, remark=?, updated_at=? WHERE id=?""",
            (
                sku,
                name,
                (data.get("category") or "").strip(),
                (data.get("cargo_type") or "普货").strip(),
                _num(data.get("length")),
                _num(data.get("width")),
                _num(data.get("height")),
                _num(data.get("purchase_price")),
                _num(data.get("domestic_shipping")),
                _num(data.get("weight")),
                (data.get("link") or "").strip(),
                (data.get("remark") or "").strip(),
                _now(),
                pid,
            ),
        )
        dbconn.commit()
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "message": f"SKU 已存在：{sku}"}), 400
    return jsonify({"ok": True})


@app.delete("/api/products/<int:pid>")
def delete_product(pid):
    dbconn = db.get_db()
    dbconn.execute("DELETE FROM products WHERE id=?", (pid,))
    dbconn.commit()
    return jsonify({"ok": True})


ALLOWED_EXT = {"png", "jpg", "jpeg", "gif", "webp", "bmp"}


@app.post("/api/products/<int:pid>/image")
def upload_product_image(pid):
    dbconn = db.get_db()
    if dbconn.execute("SELECT id FROM products WHERE id=?", (pid,)).fetchone() is None:
        return jsonify({"ok": False, "message": "产品不存在"}), 404
    file = request.files.get("file")
    if not file or file.filename == "":
        return jsonify({"ok": False, "message": "未选择文件"}), 400
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXT:
        # 兜底：粘贴的截图可能没有文件名后缀，按 mimetype 推断
        ext = {
            "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
            "image/webp": "webp", "image/bmp": "bmp",
        }.get((file.mimetype or "").lower(), "")
    if ext not in ALLOWED_EXT:
        return jsonify({"ok": False, "message": "不支持的图片格式，支持：png/jpg/jpeg/gif/webp/bmp"}), 400
    filename = f"product_{pid}_{int(time.time())}.{ext}"
    file.save(os.path.join(UPLOAD_FOLDER, filename))
    dbconn.execute("UPDATE products SET image_path=? WHERE id=?", (filename, pid))
    dbconn.commit()
    return jsonify({"ok": True, "filename": filename})


@app.put("/api/products/<int:pid>/selling-prices")
def update_product_selling_prices(pid):
    dbconn = db.get_db()
    if dbconn.execute("SELECT id FROM products WHERE id=?", (pid,)).fetchone() is None:
        return jsonify({"ok": False, "message": "产品不存在"}), 404
    data = request.get_json(silent=True) or {}
    items = data if isinstance(data, list) else data.get("items", [])
    for item in items:
        country_id = item.get("country_id")
        channel = item.get("channel", "")
        selling_price = item.get("selling_price")
        if selling_price in (None, "", "null"):
            dbconn.execute(
                "DELETE FROM product_selling_prices WHERE product_id=? AND country_id=? AND channel=?",
                (pid, country_id, channel),
            )
        else:
            sp = _num(selling_price)
            dbconn.execute(
                """INSERT INTO product_selling_prices (product_id, country_id, channel, selling_price)
                   VALUES (?,?,?,?)
                   ON CONFLICT(product_id, country_id, channel) DO UPDATE SET selling_price=?""",
                (pid, country_id, channel, sp, sp),
            )
    dbconn.commit()
    return jsonify({"ok": True})


@app.get("/api/products/<int:pid>/shipping")
def product_shipping(pid):
    dbconn = db.get_db()
    product = dbconn.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
    if product is None:
        return jsonify({"ok": False, "message": "产品不存在"}), 404
    weight = _num(product["weight"])
    cargo_type = product["cargo_type"] if "cargo_type" in product.keys() else "普货"
    purchase_price = _num(product["purchase_price"])
    domestic_shipping = _num(product["domestic_shipping"])

    # 查询匹配该产品货物类型的运费规则
    rules = dbconn.execute(
        """SELECT r.*, c.name AS country_name, c.code AS country_code, r.currency
           FROM shipping_rules r JOIN countries c ON c.id = r.country_id
           WHERE r.cargo_type=?
           ORDER BY c.sort_order, c.name, r.id""",
        (cargo_type,),
    ).fetchall()

    # 汇率
    rates = {row["currency_code"]: row["rate_to_cny"]
             for row in dbconn.execute("SELECT currency_code, rate_to_cny FROM exchange_rates")}

    # 佣金
    commissions = {row["country_id"]: row["rate"]
                   for row in dbconn.execute("SELECT country_id, rate FROM commission_rates")}

    items = []
    for rule in rules:
        if weight < rule["weight_min"]:
            continue
        if rule["weight_max"] is not None and weight > rule["weight_max"]:
            continue
        cost_original = rule["per_parcel"] + rule["per_kg"] * weight
        rate = rates.get(rule["currency"])
        cost_cny = round(cost_original * rate, 2) if rate is not None else None
        comm_rate = (commissions.get(rule["country_id"]) or 0) / 100.0
        if cost_cny is not None:
            break_even = round((purchase_price + domestic_shipping + cost_cny) / (1 - comm_rate), 2) if comm_rate < 1 else 0
            break_even_local = round(break_even / rate, 2) if rate and rate > 0 else None
            platform_commission = round(break_even * comm_rate, 2)
        else:
            break_even = None
            break_even_local = None
            platform_commission = None
        items.append({
            "country_id": rule["country_id"],
            "country_name": rule["country_name"],
            "country_code": rule["country_code"],
            "channel": rule["channel"],
            "cargo_type": rule["cargo_type"],
            "currency": rule["currency"],
            "currency_symbol": CURRENCY_SYMBOLS.get(rule["currency"], rule["currency"]),
            "weight_min": rule["weight_min"],
            "weight_max": rule["weight_max"],
            "cost_original": round(cost_original, 4),
            "rate": rate,
            "cost_cny": cost_cny,
            "commission_rate": comm_rate * 100,
            "break_even_selling_price": break_even,
            "break_even_local": break_even_local,
            "platform_commission": platform_commission,
        })
    # 补充售价与预估收益
    sp_rows = dbconn.execute(
        "SELECT country_id, channel, selling_price FROM product_selling_prices WHERE product_id=?", (pid,)
    ).fetchall()
    selling_prices = {(r["country_id"], r["channel"]): _num(r["selling_price"]) for r in sp_rows}
    for item in items:
        key = (item["country_id"], item["channel"])
        sp = selling_prices.get(key)
        item["selling_price"] = sp if sp and sp > 0 else None
        rate = item["rate"]
        comm_rate = item["commission_rate"] / 100.0
        if item["selling_price"] and item["break_even_local"] is not None:
            # 预估收益（当地货币）与其人民币折算
            item["estimated_profit"] = round(item["selling_price"] - item["break_even_local"], 2)
            item["estimated_profit_rmb"] = round(item["estimated_profit"] * rate, 2) if rate else None
            # 有售价时，平台佣金按当前售价（人民币）计算
            item["platform_commission"] = round(item["selling_price"] * rate * comm_rate, 2) if rate else None
        else:
            item["estimated_profit"] = None
            item["estimated_profit_rmb"] = None
            # 无售价时，保留盈亏平衡售价对应的佣金（上方已计算）
    return jsonify({"ok": True, "weight": weight, "items": items})


# ---------- 国家（运费/汇率共用） ----------

@app.get("/api/countries")
def list_countries():
    rows = db.get_db().execute(
        "SELECT * FROM countries ORDER BY sort_order, name"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# ---------- 运费维护 ----------

@app.get("/api/shipping-rules")
def list_shipping_rules():
    sql = """SELECT r.*, c.name AS country_name, c.code AS country_code, c.sort_order
             FROM shipping_rules r JOIN countries c ON c.id = r.country_id"""
    params = []
    country_id = request.args.get("country_id")
    if country_id:
        sql += " WHERE r.country_id=?"
        params.append(int(country_id))
    sql += " ORDER BY c.sort_order, c.name, r.id"
    rows = db.get_db().execute(sql, params).fetchall()
    return jsonify([dict(r) for r in rows])


def _validate_rule_item(data):
    """校验单条运费规则（不含国家与币种），返回 (rule, err)"""
    channel = (data.get("channel") or "").strip()
    cargo_type = (data.get("cargo_type") or "").strip()
    weight_min = _num(data.get("weight_min"), -1)
    weight_max = data.get("weight_max")
    weight_max = None if weight_max in (None, "") else _num(weight_max, -1)
    if not channel:
        return None, "物流渠道不能为空"
    if not cargo_type:
        return None, "货物类型不能为空"
    if weight_min < 0:
        return None, "最小重量不能小于 0"
    if weight_max is not None and weight_max <= weight_min:
        return None, "最大重量必须大于最小重量"
    rule = {
        "channel": channel,
        "cargo_type": cargo_type,
        "weight_min": weight_min,
        "weight_max": weight_max,
        "per_parcel": _num(data.get("per_parcel")),
        "per_kg": _num(data.get("per_kg")),
        "remark": (data.get("remark") or "").strip(),
    }
    if rule["per_parcel"] < 0 or rule["per_kg"] < 0:
        return None, "运费金额不能小于 0"
    return rule, None


def _validate_rule(data):
    country_id = data.get("country_id")
    currency = (data.get("currency") or "").strip().upper()
    if not country_id:
        return None, "请选择国家"
    if not currency:
        return None, "币种不能为空"
    rule, err = _validate_rule_item(data)
    if err:
        return None, err
    rule["country_id"] = int(country_id)
    rule["currency"] = currency
    return rule, None


@app.post("/api/shipping-rules")
def create_shipping_rule():
    data = request.get_json(silent=True) or {}
    rule, err = _validate_rule(data)
    if err:
        return jsonify({"ok": False, "message": err}), 400
    dbconn = db.get_db()
    if dbconn.execute("SELECT id FROM countries WHERE id=?", (rule["country_id"],)).fetchone() is None:
        return jsonify({"ok": False, "message": "国家不存在"}), 400
    cur = dbconn.execute(
        """INSERT INTO shipping_rules (country_id, channel, cargo_type, currency,
           weight_min, weight_max, per_parcel, per_kg, remark) VALUES (?,?,?,?,?,?,?,?,?)""",
        (
            rule["country_id"], rule["channel"], rule["cargo_type"], rule["currency"],
            rule["weight_min"], rule["weight_max"], rule["per_parcel"], rule["per_kg"],
            rule["remark"],
        ),
    )
    dbconn.commit()
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.put("/api/shipping-rules/<int:rid>")
def update_shipping_rule(rid):
    data = request.get_json(silent=True) or {}
    rule, err = _validate_rule(data)
    if err:
        return jsonify({"ok": False, "message": err}), 400
    dbconn = db.get_db()
    if dbconn.execute("SELECT id FROM shipping_rules WHERE id=?", (rid,)).fetchone() is None:
        return jsonify({"ok": False, "message": "运费规则不存在"}), 404
    dbconn.execute(
        """UPDATE shipping_rules SET country_id=?, channel=?, cargo_type=?, currency=?,
           weight_min=?, weight_max=?, per_parcel=?, per_kg=?, remark=? WHERE id=?""",
        (
            rule["country_id"], rule["channel"], rule["cargo_type"], rule["currency"],
            rule["weight_min"], rule["weight_max"], rule["per_parcel"], rule["per_kg"],
            rule["remark"], rid,
        ),
    )
    dbconn.commit()
    return jsonify({"ok": True})


@app.delete("/api/shipping-rules/<int:rid>")
def delete_shipping_rule(rid):
    dbconn = db.get_db()
    dbconn.execute("DELETE FROM shipping_rules WHERE id=?", (rid,))
    dbconn.commit()
    return jsonify({"ok": True})


# ---------- 按国家批量维护运费规则 ----------

@app.put("/api/countries/<int:cid>/shipping-rules")
def replace_country_shipping_rules(cid):
    """整体替换某国家的运费规则：币种共用，规则以列表形式维护"""
    data = request.get_json(silent=True) or {}
    currency = (data.get("currency") or "").strip().upper()
    rules = data.get("rules")
    dbconn = db.get_db()
    if dbconn.execute("SELECT id FROM countries WHERE id=?", (cid,)).fetchone() is None:
        return jsonify({"ok": False, "message": "国家不存在"}), 404
    if not currency:
        return jsonify({"ok": False, "message": "币种不能为空"}), 400
    if not isinstance(rules, list):
        return jsonify({"ok": False, "message": "规则数据格式错误"}), 400
    clean = []
    for i, item in enumerate(rules):
        rule, err = _validate_rule_item(item)
        if err:
            return jsonify({"ok": False, "message": f"第 {i + 1} 行：{err}"}), 400
        rule["currency"] = currency
        clean.append(rule)
    dbconn.execute("DELETE FROM shipping_rules WHERE country_id=?", (cid,))
    dbconn.executemany(
        """INSERT INTO shipping_rules (country_id, channel, cargo_type, currency,
           weight_min, weight_max, per_parcel, per_kg, remark)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        [
            (cid, r["channel"], r["cargo_type"], r["currency"], r["weight_min"],
             r["weight_max"], r["per_parcel"], r["per_kg"], r["remark"])
            for r in clean
        ],
    )
    dbconn.commit()
    return jsonify({"ok": True, "count": len(clean)})


@app.delete("/api/countries/<int:cid>/shipping-rules")
def clear_country_shipping_rules(cid):
    """清空某国家的全部运费规则"""
    dbconn = db.get_db()
    dbconn.execute("DELETE FROM shipping_rules WHERE country_id=?", (cid,))
    dbconn.commit()
    return jsonify({"ok": True})


# ---------- 汇率维护 ----------

@app.get("/api/exchange-rates")
def list_exchange_rates():
    rows = db.get_db().execute(
        """SELECT c.id AS country_id, c.name AS country_name, c.code AS country_code,
                  c.currency_code, r.id AS rate_id, r.rate_to_cny, r.source, r.updated_at
           FROM countries c
           LEFT JOIN exchange_rates r ON r.currency_code = c.currency_code
           ORDER BY c.sort_order, c.name"""
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/countries")
def create_country():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    code = (data.get("code") or "").strip().upper()
    currency = (data.get("currency_code") or "").strip().upper()
    if not name or not code or not currency:
        return jsonify({"ok": False, "message": "国家名称、国家代码、币种均不能为空"}), 400
    dbconn = db.get_db()
    try:
        cur = dbconn.execute(
            "INSERT INTO countries (name, code, currency_code, sort_order) VALUES (?,?,?, (SELECT IFNULL(MAX(sort_order),0)+1 FROM countries))",
            (name, code, currency),
        )
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "message": f"国家已存在：{name}"}), 400
    # 尝试自动获取该币种汇率
    live, _src = _fetch_live_rates()
    rate_val = data.get("rate_to_cny")
    if rate_val not in (None, ""):
        _upsert_rate(dbconn, currency, _num(rate_val), "manual")
    elif live:
        _apply_rate_for_currency(dbconn, currency, live, "auto")
    dbconn.commit()
    return jsonify({"ok": True, "id": cur.lastrowid})


@app.put("/api/countries/<int:cid>")
def update_country(cid):
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    code = (data.get("code") or "").strip().upper()
    currency = (data.get("currency_code") or "").strip().upper()
    if not name or not code or not currency:
        return jsonify({"ok": False, "message": "国家名称、国家代码、币种均不能为空"}), 400
    dbconn = db.get_db()
    row = dbconn.execute("SELECT * FROM countries WHERE id=?", (cid,)).fetchone()
    if row is None:
        return jsonify({"ok": False, "message": "国家不存在"}), 404
    old_currency = row["currency_code"]
    try:
        dbconn.execute(
            "UPDATE countries SET name=?, code=?, currency_code=? WHERE id=?",
            (name, code, currency, cid),
        )
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "message": f"国家已存在：{name}"}), 400
    rate_val = data.get("rate_to_cny")
    if rate_val not in (None, ""):
        _upsert_rate(dbconn, currency, _num(rate_val), "manual")
    elif currency != old_currency:
        # 币种变更且未手动填汇率，尝试自动获取
        live, _src = _fetch_live_rates()
        _apply_rate_for_currency(dbconn, currency, live, "auto")
    dbconn.commit()
    return jsonify({"ok": True})


@app.delete("/api/countries/<int:cid>")
def delete_country(cid):
    dbconn = db.get_db()
    row = dbconn.execute("SELECT currency_code FROM countries WHERE id=?", (cid,)).fetchone()
    if row is None:
        return jsonify({"ok": False, "message": "国家不存在"}), 404
    dbconn.execute("DELETE FROM countries WHERE id=?", (cid,))
    # 若该币种不再被任何国家使用，则同步删除汇率
    still_used = dbconn.execute(
        "SELECT 1 FROM countries WHERE currency_code=?", (row["currency_code"],)
    ).fetchone()
    if not still_used:
        dbconn.execute("DELETE FROM exchange_rates WHERE currency_code=?", (row["currency_code"],))
    dbconn.commit()
    return jsonify({"ok": True})


@app.put("/api/countries/reorder")
def reorder_countries():
    """批量更新国家排序"""
    data = request.get_json(silent=True) or {}
    order = data.get("order")
    if not isinstance(order, list):
        return jsonify({"ok": False, "message": "数据格式错误"}), 400
    dbconn = db.get_db()
    for i, item in enumerate(order):
        cid = item.get("id")
        if cid:
            dbconn.execute("UPDATE countries SET sort_order=? WHERE id=?", (i, cid))
    dbconn.commit()
    return jsonify({"ok": True})


@app.put("/api/exchange-rates/<int:rid>")
def update_rate(rid):
    data = request.get_json(silent=True) or {}
    rate = _num(data.get("rate_to_cny"))
    if rate <= 0:
        return jsonify({"ok": False, "message": "汇率必须大于 0"}), 400
    dbconn = db.get_db()
    if dbconn.execute("SELECT id FROM exchange_rates WHERE id=?", (rid,)).fetchone() is None:
        return jsonify({"ok": False, "message": "汇率记录不存在"}), 404
    dbconn.execute(
        "UPDATE exchange_rates SET rate_to_cny=?, source='manual', updated_at=? WHERE id=?",
        (rate, _now(), rid),
    )
    dbconn.commit()
    return jsonify({"ok": True})


@app.post("/api/exchange-rates/refresh")
def refresh_rates():
    live, src = _fetch_live_rates()
    if not live:
        return jsonify({"ok": False, "message": "获取实时汇率失败，请检查网络连接后重试"}), 502
    dbconn = db.get_db()
    updated = _refresh_all_rates(dbconn, live, "auto")
    dbconn.commit()
    return jsonify({"ok": True, "updated": updated, "source": src, "as_of": _now()})


@app.get("/api/exchange-rates/status")
def rates_status():
    dbconn = db.get_db()
    last = _last_auto_update(dbconn)
    stale = False
    if last:
        try:
            last_dt = datetime.strptime(last, "%Y-%m-%d %H:%M:%S")
            stale = (datetime.now() - last_dt).total_seconds() > STALE_HOURS * 3600
        except ValueError:
            stale = True
    return jsonify({"last_auto_update": last, "stale": last is None or stale})


# ---------- 佣金维护 ----------

@app.get("/api/commissions")
def list_commissions():
    rows = db.get_db().execute(
        """SELECT cr.id, cr.country_id, cr.rate, c.name AS country_name, c.code AS country_code
           FROM commission_rates cr JOIN countries c ON c.id = cr.country_id
           ORDER BY c.sort_order, c.name"""
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.put("/api/commissions/<int:cid>")
def update_commission(cid):
    data = request.get_json(silent=True) or {}
    rate = _num(data.get("rate"))
    if rate <= 0 or rate >= 100:
        return jsonify({"ok": False, "message": "佣金率必须在 0~100 之间"}), 400
    dbconn = db.get_db()
    row = dbconn.execute("SELECT id FROM commission_rates WHERE country_id=?", (cid,)).fetchone()
    if row is None:
        return jsonify({"ok": False, "message": "该国家佣金记录不存在"}), 404
    dbconn.execute("UPDATE commission_rates SET rate=? WHERE country_id=?", (rate, cid))
    dbconn.commit()
    return jsonify({"ok": True})


# ---------- 启动 ----------

def _startup_refresh():
    """启动时后台静默刷新一次汇率（避免页面首次打开无数据）"""
    with app.app_context():
        dbconn = db.get_db()
        if _last_auto_update(dbconn) is None:
            live, _src = _fetch_live_rates()
            if live:
                _refresh_all_rates(dbconn, live, "auto")
                dbconn.commit()
        db.close_db()


if __name__ == "__main__":
    db.init_db()
    threading.Timer(2.0, _startup_refresh).start()
    # NAS/Docker 部署：默认监听所有网卡、端口 5050，可用环境变量 HOST/PORT 覆盖
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5050"))
    print(f"\n产品SKU管理系统已启动： http://{host}:{port}  （局域网访问： http://<NAS-IP>:{port}）\n")
    app.run(host=host, port=port, debug=False, threaded=True)
