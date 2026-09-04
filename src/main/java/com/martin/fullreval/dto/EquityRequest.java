package com.martin.fullreval.dto;

import java.math.BigDecimal;

public class EquityRequest {
    public String name;
    public BigDecimal shares;
    public BigDecimal baseSpot;
    public String currency = "USD";
    public BigDecimal baseFxRate = BigDecimal.ONE;
}
