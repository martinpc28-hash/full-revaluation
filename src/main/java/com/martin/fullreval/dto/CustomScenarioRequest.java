package com.martin.fullreval.dto;

import java.math.BigDecimal;

/** A single, deterministic, user-specified macro shock (a "stress test" scenario), as
 * opposed to the random Monte Carlo scenario set used for VaR. */
public class CustomScenarioRequest {
    public String scenarioSetId;
    public BigDecimal rateShockBp = BigDecimal.ZERO;
    public BigDecimal spotShockPct = BigDecimal.ZERO;
    public BigDecimal volShockAbs = BigDecimal.ZERO;
    public BigDecimal fxShockPct = BigDecimal.ZERO;
}
