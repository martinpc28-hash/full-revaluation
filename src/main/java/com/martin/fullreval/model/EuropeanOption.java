package com.martin.fullreval.model;

import jakarta.persistence.Column;
import jakarta.persistence.DiscriminatorValue;
import jakarta.persistence.Entity;
import java.math.BigDecimal;

/**
 * Vanilla European call/put, priced by Black-Scholes revaluation
 * under the shocked spot/vol/rate of the scenario.
 * Actual math lives in service.pricing.BlackScholesPricer so it stays
 * testable in isolation from JPA.
 */
@Entity
@DiscriminatorValue("EUROPEAN_OPTION")
public class EuropeanOption extends Instrument {

    public enum OptionType { CALL, PUT }

    @Column(name = "OPTION_TYPE")
    private OptionType optionType;

    @Column(name = "STRIKE", precision = 18, scale = 4)
    private BigDecimal strike;

    @Column(name = "BASE_SPOT", precision = 18, scale = 4)
    private BigDecimal baseSpot;

    @Column(name = "BASE_VOL", precision = 9, scale = 6)
    private BigDecimal baseVol; // e.g. 0.20 = 20% annualized

    @Column(name = "RISK_FREE_RATE", precision = 9, scale = 6)
    private BigDecimal riskFreeRate;

    @Column(name = "YEARS_TO_EXPIRY", precision = 9, scale = 6)
    private BigDecimal yearsToExpiry;

    @Override
    public BigDecimal priceUnderScenario(MarketScenario scenario) {
        BigDecimal shockedSpot = baseSpot.multiply(BigDecimal.ONE.add(scenario.getSpotShockPct()));
        BigDecimal shockedVol = baseVol.add(scenario.getVolShockAbs());
        BigDecimal shockedRate = riskFreeRate.add(scenario.getRateShockBp()
                .divide(BigDecimal.valueOf(10000)));

        double premium = com.martin.fullreval.service.pricing.BlackScholesPricer.price(
                optionType == OptionType.CALL,
                shockedSpot.doubleValue(),
                strike.doubleValue(),
                shockedRate.doubleValue(),
                shockedVol.doubleValue(),
                yearsToExpiry.doubleValue()
        );
        return getNotional().multiply(BigDecimal.valueOf(premium));
    }

    public OptionType getOptionType() { return optionType; }
    public void setOptionType(OptionType optionType) { this.optionType = optionType; }
    public BigDecimal getStrike() { return strike; }
    public void setStrike(BigDecimal strike) { this.strike = strike; }
    public BigDecimal getBaseSpot() { return baseSpot; }
    public void setBaseSpot(BigDecimal baseSpot) { this.baseSpot = baseSpot; }
    public BigDecimal getBaseVol() { return baseVol; }
    public void setBaseVol(BigDecimal baseVol) { this.baseVol = baseVol; }
    public BigDecimal getRiskFreeRate() { return riskFreeRate; }
    public void setRiskFreeRate(BigDecimal riskFreeRate) { this.riskFreeRate = riskFreeRate; }
    public BigDecimal getYearsToExpiry() { return yearsToExpiry; }
    public void setYearsToExpiry(BigDecimal yearsToExpiry) { this.yearsToExpiry = yearsToExpiry; }
}
