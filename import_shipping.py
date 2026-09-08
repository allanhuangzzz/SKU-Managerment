# -*- coding: utf-8 -*-
"""一次性导入：按运费模板整表覆盖 shipping_rules，并补齐缺失国家。

模板中每一行 = (物流渠道, 货物类型, 币种) + 横向展开的多个重量区间，
每个区间含独立的 per Parcel / per Kg，因此一行会拆成多条运费明细。
"""
import json
import sqlite3
import urllib.request
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "sku.db"


def _try_live_rates():
    """获取实时汇率 {币种: 1外币兑人民币}；失败返回 {}。"""
    try:
        req = urllib.request.Request(
            "https://open.er-api.com/v6/latest/USD",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        rates = data.get("rates") or {}
        cny_per_usd = rates.get("CNY")
        if not cny_per_usd:
            return {}
        # rates[X] = 1 USD 兑 X；故 1 X 兑人民币 = CNY / rates[X]
        out = {}
        for ccy, v in rates.items():
            if v:
                out[ccy] = round(cny_per_usd / v, 6)
        return out
    except Exception:
        return {}

# 标准 5 段重量区间：(min, max)   max=None 表示上不封顶（此处 30 为模板上限）
W5 = [(0, 0.3), (0.3, 0.5), (0.5, 1), (1, 2), (2, 30)]
# 西班牙(偏远地区) 特殊 4 段区间
W_ES_REMOTE = [(0, 0.35), (0.35, 1), (1, 3), (3, 30)]

# 需要确保存在的国家： name -> (code, currency_code)
NEED_COUNTRIES = {
    "捷克": ("CZ", "CZK"),
    "比利时": ("BE", "EUR"),
    "奥地利": ("AT", "EUR"),
    "匈牙利": ("HU", "HUF"),
    "希腊": ("GR", "EUR"),
    "葡萄牙": ("PT", "EUR"),
    "西班牙(偏远地区)": ("ES", "EUR"),
}

# ---------- 模板数据 ----------
# 每条 = (国家名, 渠道, 货物类型, 币种, 重量区间列表, [(per_parcel, per_kg), ...])

def row5(pp_kg):
    """pp_kg: 5 组 (per_parcel, per_kg)"""
    return (W5, pp_kg)

DATA = []

# ===== 波兰 PLN =====
DATA += [
    ("波兰", "Home Delivery", "普货", "PLN", *row5([(8.75,26.25),(9.80,27.35),(11.90,27.35),(11.90,30.50),(11.90,33.65)])),
    ("波兰", "Home Delivery", "特货", "PLN", *row5([(9.05,28.90),(10.15,29.45),(12.35,29.45),(12.35,32.75),(12.35,35.95)])),
    ("波兰", "Home Delivery", "敏货", "PLN", *row5([(9.05,28.90),(10.15,29.45),(12.35,29.45),(12.35,32.75),(12.35,35.95)])),
    ("波兰", "Pudo", "普货", "PLN", *row5([(15.65,29.45),(15.65,30.00),(15.65,30.00),(12.35,32.75),(12.35,32.75)])),
    ("波兰", "Pudo", "特货", "PLN", *row5([(15.65,29.45),(15.65,30.00),(15.65,30.00),(12.35,32.75),(12.35,32.75)])),
    ("波兰", "Pudo", "敏货", "PLN", *row5([(15.65,29.45),(15.65,30.00),(15.65,30.00),(12.35,32.75),(12.35,32.75)])),
]

# ===== 荷兰 EUR =====
DATA += [
    ("荷兰", "Standard", "普货", "EUR", *row5([(3.14,7.67),(3.14,7.67),(2.76,6.65),(2.76,6.26),(2.76,6.26)])),
    ("荷兰", "Standard", "特货", "EUR", *row5([(3.43,7.60),(3.43,7.60),(3.43,7.60),(3.43,7.60),(3.43,7.60)])),
    ("荷兰", "Standard", "敏货", "EUR", *row5([(3.43,7.60),(3.43,7.60),(3.43,7.60),(3.43,7.60),(3.43,7.60)])),
]

# ===== 比利时 EUR =====
DATA += [
    ("比利时", "Standard", "普货", "EUR", *row5([(3.02,11.50),(3.02,11.50),(2.76,9.72),(2.76,9.72),(2.76,9.72)])),
    ("比利时", "Standard", "特货", "EUR", *row5([(3.02,12.64),(3.02,12.64),(2.76,10.48),(2.76,10.48),(2.76,10.48)])),
    ("比利时", "Standard", "敏货", "EUR", *row5([(3.02,12.64),(3.02,12.64),(2.76,10.48),(2.76,10.48),(2.76,10.48)])),
]

# ===== 奥地利 EUR =====
DATA += [
    ("奥地利", "Standard", "普货", "EUR", *row5([(3.02,9.72),(3.02,9.72),(3.02,7.92),(3.02,7.92),(3.02,7.92)])),
    ("奥地利", "Standard", "特货", "EUR", *row5([(3.02,10.99),(3.02,10.99),(3.02,8.18),(3.02,8.18),(3.02,8.18)])),
    ("奥地利", "Standard", "敏货", "EUR", *row5([(3.02,11.25),(3.02,11.25),(3.02,8.43),(3.02,8.43),(3.02,8.43)])),
]

# ===== 匈牙利 HUF =====
DATA += [
    ("匈牙利", "Standard", "普货", "HUF", *row5([(982.00,1909.00),(982.00,1909.00),(982.00,2181.00),(982.00,2181.00),(982.00,2181.00)])),
    ("匈牙利", "Standard", "特货", "HUF", *row5([(982.00,2000.00),(982.00,2000.00),(982.00,2272.00),(982.00,2272.00),(982.00,2272.00)])),
    ("匈牙利", "Standard", "敏货", "HUF", *row5([(982.00,2000.00),(982.00,2000.00),(982.00,2272.00),(982.00,2272.00),(982.00,2272.00)])),
]

# ===== 捷克 CZK =====
DATA += [
    ("捷克", "Home Delivery", "普货", "CZK", *row5([(45.50,168.60),(50.20,168.60),(50.20,174.80),(56.10,174.80),(56.10,180.70)])),
    ("捷克", "Home Delivery", "特货", "CZK", *row5([(46.90,168.60),(50.20,171.50),(50.20,177.70),(56.10,177.70),(56.10,180.70)])),
    ("捷克", "Home Delivery", "敏货", "CZK", *row5([(46.90,168.60),(50.20,171.50),(50.20,177.70),(56.10,177.70),(56.10,180.70)])),
    ("捷克", "Pudo", "普货", "CZK", *row5([(45.50,168.60),(50.20,168.60),(50.20,174.80),(56.10,174.80),(56.10,180.70)])),
    ("捷克", "Pudo", "特货", "CZK", *row5([(44.00,168.60),(46.90,171.50),(46.90,177.70),(56.10,177.70),(56.10,180.70)])),
    ("捷克", "Pudo", "敏货", "CZK", *row5([(44.00,168.60),(46.90,171.50),(46.90,177.70),(56.10,177.70),(56.10,180.70)])),
]

# ===== 希腊 EUR =====
DATA += [
    ("希腊", "Standard", "普货", "EUR", *row5([(2.38,8.94),(2.38,8.94),(2.38,8.94),(2.38,8.94),(2.38,8.94)])),
    ("希腊", "Standard", "特货", "EUR", *row5([(2.38,9.20),(2.38,9.20),(2.38,9.20),(2.38,9.20),(2.38,9.20)])),
    ("希腊", "Standard", "敏货", "EUR", *row5([(2.38,9.58),(2.38,9.58),(2.38,9.58),(2.38,9.58),(2.38,9.58)])),
]

# ===== 葡萄牙 EUR =====
DATA += [
    ("葡萄牙", "Standard", "普货", "EUR", *row5([(3.30,5.54),(3.30,6.44),(3.30,6.71),(3.30,7.35),(3.30,7.35)])),
    ("葡萄牙", "Standard", "特货", "EUR", *row5([(3.30,5.68),(3.30,6.57),(3.30,6.83),(3.30,7.47),(3.30,7.47)])),
    ("葡萄牙", "Standard", "敏货", "EUR", *row5([(3.30,5.68),(3.30,6.57),(3.30,6.83),(3.30,7.47),(3.30,7.47)])),
]

# ===== 西班牙(偏远地区) EUR —— 特殊 4 段区间 =====
DATA += [
    ("西班牙(偏远地区)", "Standard", "普货", "EUR", W_ES_REMOTE, [(5,5.8),(5,5.8),(5,5.8),(5,5.8)]),
    ("西班牙(偏远地区)", "Standard", "特货", "EUR", W_ES_REMOTE, [(5,6.2),(5,6.2),(5,6.2),(5,6.2)]),
    ("西班牙(偏远地区)", "Standard", "敏货", "EUR", W_ES_REMOTE, [(5.1,6.5),(5.1,6.8),(5.1,6.8),(5.1,6.8)]),
]

# ===== 法国 EUR =====
DATA += [
    ("法国", "Standard", "普货", "EUR", *row5([(3.15,7.6),(3.15,7.6),(3.15,7.7),(3.15,7.7),(3.15,7.8)])),
    ("法国", "Standard", "特货", "EUR", *row5([(3.15,8),(3.15,8),(3.15,8.1),(3.15,8.1),(3.15,8.1)])),
    ("法国", "Standard", "敏货", "EUR", *row5([(3.15,8.1),(3.15,8.2),(3.15,8.2),(3.15,8.2),(3.15,8.2)])),
]

# ===== 德国 EUR =====
DATA += [
    ("德国", "Standard", "普货", "EUR", *row5([(2.9,8.4),(2.85,8.35),(2.85,8.35),(2.85,8.1),(2.85,8)])),
    ("德国", "Standard", "特货", "EUR", *row5([(3.1,8.4),(3,8.4),(3,8.3),(3,8.2),(3,8.1)])),
    ("德国", "Standard", "敏货", "EUR", *row5([(3.1,8.5),(3,8.4),(3,8.4),(3,8.3),(3,8.2)])),
]

# ===== 西班牙 EUR =====
DATA += [
    ("西班牙", "Standard", "普货", "EUR", *row5([(2.65,6.8),(2.7,6.8),(2.7,6.8),(2.7,6.85),(2.7,6.85)])),
    ("西班牙", "Standard", "特货", "EUR", *row5([(2.7,7.4),(2.7,7.4),(2.7,7.45),(2.7,7.55),(2.7,7.8)])),
    ("西班牙", "Standard", "敏货", "EUR", *row5([(2.85,7.4),(2.75,7.7),(2.75,7.8),(2.75,8),(2.75,8.2)])),
]

# ===== 意大利 EUR =====
DATA += [
    ("意大利", "Standard", "普货", "EUR", *row5([(3.2,7.7),(3.2,7.5),(3.2,7.5),(3.2,7.5),(3.2,7.5)])),
    ("意大利", "Standard", "特货", "EUR", *row5([(3.4,8.7),(3.2,8.5),(3.1,8.5),(3.1,8.3),(3.1,8.3)])),
    ("意大利", "Standard", "敏货", "EUR", *row5([(3.4,8.7),(3.3,8.5),(3.3,8.45),(3.3,8.45),(3.3,8.4)])),
]


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    # 1) 补齐缺失国家
    for name, (code, cur) in NEED_COUNTRIES.items():
        exists = conn.execute("SELECT id FROM countries WHERE name=?", (name,)).fetchone()
        if not exists:
            max_order = conn.execute("SELECT IFNULL(MAX(sort_order),0) FROM countries").fetchone()[0]
            conn.execute(
                "INSERT INTO countries (name, code, currency_code, sort_order) VALUES (?,?,?,?)",
                (name, code, cur, max_order + 1),
            )
            print(f"新增国家: {name} ({code}/{cur})")

    # 国家名 -> id
    name2id = {r["name"]: r["id"] for r in conn.execute("SELECT id, name FROM countries")}

    # 2) 整表覆盖：先清空本次涉及国家的运费
    involved = {d[0] for d in DATA}
    ids = [name2id[n] for n in involved if n in name2id]
    conn.executemany("DELETE FROM shipping_rules WHERE country_id=?", [(i,) for i in ids])

    # 3) 拆分明细写入
    inserted = 0
    for name, channel, cargo, currency, ranges, pairs in DATA:
        cid = name2id[name]
        assert len(ranges) == len(pairs), f"{name}/{channel}/{cargo} 区间数与数值数不匹配"
        for (wmin, wmax), (pp, pk) in zip(ranges, pairs):
            conn.execute(
                """INSERT INTO shipping_rules (country_id, channel, cargo_type, currency,
                   weight_min, weight_max, per_parcel, per_kg, remark)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (cid, channel, cargo, currency, wmin, wmax, pp, pk, ""),
            )
            inserted += 1

    # 4) 为新增国家补佣金记录（默认 13%，与 init_db 规则一致）
    for name in NEED_COUNTRIES:
        cid = name2id.get(name)
        if cid is None:
            continue
        has = conn.execute("SELECT 1 FROM commission_rates WHERE country_id=?", (cid,)).fetchone()
        if not has:
            conn.execute("INSERT INTO commission_rates (country_id, rate) VALUES (?, 13.0)", (cid,))
            print(f"补佣金: {name} -> 13%")

    # 5) 补齐缺失币种汇率（CZK / HUF），优先实时接口，失败回退到内置近似值
    need_ccy = {"CZK", "HUF"}
    have_ccy = {r[0] for r in conn.execute("SELECT currency_code FROM exchange_rates")}
    missing = need_ccy - have_ccy
    if missing:
        live = _try_live_rates()
        # 近似回退汇率（1 外币 = ? 人民币），仅在实时获取失败时使用
        fallback = {"CZK": 0.315, "HUF": 0.0198}
        for ccy in missing:
            rate = live.get(ccy)
            src = "auto"
            if rate is None:
                rate = fallback.get(ccy)
                src = "manual"
            if rate is not None:
                conn.execute(
                    "INSERT OR REPLACE INTO exchange_rates (currency_code, rate_to_cny, source, updated_at) "
                    "VALUES (?,?,?, datetime('now','localtime'))",
                    (ccy, rate, src),
                )
                print(f"补汇率: {ccy} = {rate} ({src})")

    conn.commit()

    # 6) 汇总校验
    print(f"\n共写入运费明细 {inserted} 条")
    print("按国家统计：")
    for r in conn.execute(
        """SELECT c.name, COUNT(*) n FROM shipping_rules r
           JOIN countries c ON c.id=r.country_id
           GROUP BY c.id ORDER BY c.sort_order"""
    ):
        print(f"  {r['name']}: {r['n']} 条")
    conn.close()


if __name__ == "__main__":
    main()
