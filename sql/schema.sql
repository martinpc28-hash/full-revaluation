-- Full Revaluation engine schema, Oracle DB
-- Run this once against the RDS Oracle instance before starting the app.

CREATE SEQUENCE instrument_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE scenario_seq   START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE result_seq     START WITH 1 INCREMENT BY 50;

CREATE TABLE instruments (
    instrument_id     NUMBER PRIMARY KEY,
    instrument_type   VARCHAR2(30)   NOT NULL,   -- 'BOND', 'EUROPEAN_OPTION' or 'EQUITY'
    name              VARCHAR2(200)  NOT NULL,
    notional          NUMBER(18,4)   NOT NULL,
    portfolio_id      NUMBER         NOT NULL,

    -- Booking currency; base (reporting) currency is USD.
    currency          VARCHAR2(3)    DEFAULT 'USD' NOT NULL,
    base_fx_rate      NUMBER(18,6)   DEFAULT 1,     -- units of USD per 1 unit of `currency` at t0

    -- Bond fields (NULL for options/equities)
    coupon_rate       NUMBER(9,6),
    years_to_maturity NUMBER(5),
    base_yield        NUMBER(9,6),

    -- Option fields (NULL for bonds/equities)
    option_type       VARCHAR2(10),              -- 'CALL' or 'PUT'
    strike            NUMBER(18,4),
    base_spot         NUMBER(18,4),
    base_vol          NUMBER(9,6),
    risk_free_rate    NUMBER(9,6),
    years_to_expiry   NUMBER(9,6),

    -- Equity fields (NULL for bonds/options)
    shares            NUMBER(18,4),
    eq_base_spot      NUMBER(18,4)
);

CREATE INDEX idx_instruments_portfolio ON instruments (portfolio_id);

CREATE TABLE market_scenarios (
    scenario_id       NUMBER PRIMARY KEY,
    scenario_set_id   VARCHAR2(100) NOT NULL,
    scenario_date     DATE,
    rate_shock_bp     NUMBER(9,4),
    spot_shock_pct    NUMBER(9,6),
    vol_shock_abs     NUMBER(9,6),
    fx_shock_pct      NUMBER(9,6) DEFAULT 0
);

CREATE INDEX idx_scenarios_set ON market_scenarios (scenario_set_id);

CREATE TABLE revaluation_results (
    result_id         NUMBER PRIMARY KEY,
    run_id            VARCHAR2(36) NOT NULL,
    instrument_id     NUMBER NOT NULL,
    scenario_id       NUMBER NOT NULL,
    base_value        NUMBER(18,4),
    revalued_value    NUMBER(18,4),
    pnl               NUMBER(18,4),
    CONSTRAINT fk_result_instrument FOREIGN KEY (instrument_id) REFERENCES instruments (instrument_id),
    CONSTRAINT fk_result_scenario   FOREIGN KEY (scenario_id)   REFERENCES market_scenarios (scenario_id)
);

-- This is the table that grows to instruments x scenarios per run, so
-- run_id is indexed for fast retrieval of a single run's results (used
-- to compute VaR) and periodically archived/purged in a real deployment.
CREATE INDEX idx_results_run ON revaluation_results (run_id);
