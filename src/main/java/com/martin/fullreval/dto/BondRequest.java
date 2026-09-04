package com.martin.fullreval.dto;

import java.math.BigDecimal;

public class BondRequest {
    public String name;
    public BigDecimal notional;
    public BigDecimal couponRate;
    public Integer yearsToMaturity;
    public BigDecimal baseYield;
    public String currency = "USD";
    public BigDecimal baseFxRate = BigDecimal.ONE;
}
