package com.martin.fullreval.dto;

import com.martin.fullreval.model.EuropeanOption.OptionType;
import java.math.BigDecimal;

public class OptionRequest {
    public String name;
    public BigDecimal notional;
    public OptionType optionType;
    public BigDecimal strike;
    public BigDecimal baseSpot;
    public BigDecimal baseVol;
    public BigDecimal riskFreeRate;
    public BigDecimal yearsToExpiry;
    public String currency = "USD";
    public BigDecimal baseFxRate = BigDecimal.ONE;
}
