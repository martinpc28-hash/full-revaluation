"""
Full Revaluation demo — same logic as the Java engine (Bond DCF + Black-Scholes
options), running locally with SQLite instead of Oracle RDS. Zero AWS cost.
Mirrors: model/Bond.java, model/EuropeanOption.java, service/RevaluationService.java
"""
import sqlite3
import math
import random
import statistics

random.seed(42)

# ---------- Pricing functions (same math as BlackScholesPricer.java / Bond.java) ----------

def price_bond(notional, coupon_rate, years_to_maturity, base_yield, rate_shock_bp):
    shocked_yield = base_yield + rate_shock_bp / 10000
    price = 0.0
    for t in range(1, years_to_maturity + 1):
        cashflow = notional * coupon_rate
        if t == years_to_maturity:
            cashflow += notional
        price += cashflow / ((1 + shocked_yield) ** t)
    return price

def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def price_option(is_call, spot, strike, rate, vol, years_to_expiry):
    if years_to_expiry <= 0:
        return max(spot - strike, 0) if is_call else max(strike - spot, 0)
    d1 = (math.log(spot / strike) + (rate + 0.5 * vol ** 2) * years_to_expiry) / (vol * math.sqrt(years_to_expiry))
    d2 = d1 - vol * math.sqrt(years_to_expiry)
    if is_call:
        return spot * norm_cdf(d1) - strike * math.exp(-rate * years_to_expiry) * norm_cdf(d2)
    else:
        return strike * math.exp(-rate * years_to_expiry) * norm_cdf(-d2) - spot * norm_cdf(-d1)

# ---------- "Database" layer: SQLite standing in for Oracle ----------

conn = sqlite3.connect(":memory:")
conn.execute("""CREATE TABLE instruments (
    id INTEGER PRIMARY KEY, type TEXT, name TEXT, notional REAL,
    coupon_rate REAL, years_to_maturity INTEGER, base_yield REAL,
    option_type TEXT, strike REAL, base_spot REAL, base_vol REAL,
    risk_free_rate REAL, years_to_expiry REAL)""")
conn.execute("""CREATE TABLE scenarios (
    id INTEGER PRIMARY KEY, rate_shock_bp REAL, spot_shock_pct REAL, vol_shock_abs REAL)""")
conn.execute("""CREATE TABLE results (
    instrument_id INTEGER, scenario_id INTEGER, base_value REAL, revalued_value REAL, pnl REAL)""")

# Portfolio: 1 fixed-coupon bond + 1 European call, same as the skeleton's default sample
conn.execute("""INSERT INTO instruments (id, type, name, notional, coupon_rate, years_to_maturity, base_yield)
                VALUES (1, 'BOND', '5Y Corp Bond', 1000000, 0.035, 5, 0.03)""")
conn.execute("""INSERT INTO instruments (id, type, name, notional, option_type, strike, base_spot, base_vol, risk_free_rate, years_to_expiry)
                VALUES (2, 'EUROPEAN_OPTION', 'Call on IBEX proxy', 10000, 'CALL', 100, 100, 0.20, 0.03, 1.0)""")

# Generate 250 synthetic historical-style scenarios (same distribution as ScenarioController.java)
scenarios = []
for i in range(250):
    rate_shock = random.gauss(0, 15)      # ~15bp daily vol
    spot_shock = random.gauss(0, 0.015)   # ~1.5% daily vol
    vol_shock = random.gauss(0, 0.01)     # ~1 vol point
    conn.execute("INSERT INTO scenarios (id, rate_shock_bp, spot_shock_pct, vol_shock_abs) VALUES (?,?,?,?)",
                 (i, rate_shock, spot_shock, vol_shock))
    scenarios.append((i, rate_shock, spot_shock, vol_shock))
conn.commit()

# ---------- Full Revaluation run ----------

instruments = conn.execute("SELECT * FROM instruments").fetchall()
run_results = []

for inst in instruments:
    (iid, itype, name, notional, coupon_rate, years_to_maturity, base_yield,
     option_type, strike, base_spot, base_vol, risk_free_rate, years_to_expiry) = inst

    if itype == 'BOND':
        base_value = price_bond(notional, coupon_rate, years_to_maturity, base_yield, 0)
    else:
        base_value = notional * price_option(option_type == 'CALL', base_spot, strike, risk_free_rate, base_vol, years_to_expiry)

    for sid, rate_shock, spot_shock, vol_shock in scenarios:
        if itype == 'BOND':
            revalued = price_bond(notional, coupon_rate, years_to_maturity, base_yield, rate_shock)
        else:
            shocked_spot = base_spot * (1 + spot_shock)
            shocked_vol = base_vol + vol_shock
            shocked_rate = risk_free_rate + rate_shock / 10000
            revalued = notional * price_option(option_type == 'CALL', shocked_spot, strike, shocked_rate, shocked_vol, years_to_expiry)

        pnl = revalued - base_value
        run_results.append((iid, sid, base_value, revalued, pnl))

conn.executemany("INSERT INTO results VALUES (?,?,?,?,?)", run_results)
conn.commit()

# ---------- Portfolio VaR ----------

pnl_by_scenario = {}
for iid, sid, base_value, revalued, pnl in run_results:
    pnl_by_scenario[sid] = pnl_by_scenario.get(sid, 0) + pnl

losses = sorted(pnl_by_scenario.values())
confidence = 0.99
index = max(0, min(int((1 - confidence) * len(losses)), len(losses) - 1))
var_99 = -losses[index]

print("=== Full Revaluation run complete (SQLite, zero cost, 100% local) ===")
print(f"Instruments: {len(instruments)} | Scenarios: {len(scenarios)} | Reprices: {len(run_results)}")
print()
for inst in instruments:
    name = inst[2]
    base_row = [r for r in run_results if r[0] == inst[0]][0]
    print(f"  {name}: base value = {base_row[2]:,.2f}")
print()
print(f"Portfolio 99% VaR (1-day, from {len(scenarios)} scenarios): {var_99:,.2f}")
print(f"Worst simulated scenario P&L: {losses[0]:,.2f}")
print(f"Best simulated scenario P&L: {losses[-1]:,.2f}")
print(f"Mean scenario P&L: {statistics.mean(losses):,.2f}")
