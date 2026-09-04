package com.martin.fullreval.model;

import jakarta.persistence.DiscriminatorValue;
import jakarta.persistence.Entity;
import jakarta.persistence.Column;
import java.math.BigDecimal;
import java.math.MathContext;

/**
 * Fixed-coupon bond, priced by full discounted-cashflow revaluation
 * (not duration/convexity approximation) under a shocked flat curve.
 */
@Entity
@DiscriminatorValue("BOND")
public class Bond extends Instrument {

    @Column(name = "COUPON_RATE", precision = 9, scale = 6)
    private BigDecimal couponRate; // annual, e.g. 0.035 = 3.5%

    @Column(name = "YEARS_TO_MATURITY")
    private Integer yearsToMaturity;

    @Column(name = "BASE_YIELD", precision = 9, scale = 6)
    private BigDecimal baseYield; // yield used at t0, before shocks

    @Override
    public BigDecimal priceUnderScenario(MarketScenario scenario) {
        BigDecimal shockedYield = baseYield.add(scenario.getRateShockBp()
                .divide(BigDecimal.valueOf(10000), MathContext.DECIMAL64));

        BigDecimal price = BigDecimal.ZERO;
        for (int t = 1; t <= yearsToMaturity; t++) {
            BigDecimal cashflow = getNotional().multiply(couponRate);
            if (t == yearsToMaturity) {
                cashflow = cashflow.add(getNotional());
            }
            BigDecimal discountFactor = BigDecimal.ONE.add(shockedYield)
                    .pow(t, MathContext.DECIMAL64);
            price = price.add(cashflow.divide(discountFactor, MathContext.DECIMAL64));
        }
        return price;
    }

    public BigDecimal getCouponRate() { return couponRate; }
    public void setCouponRate(BigDecimal couponRate) { this.couponRate = couponRate; }
    public Integer getYearsToMaturity() { return yearsToMaturity; }
    public void setYearsToMaturity(Integer yearsToMaturity) { this.yearsToMaturity = yearsToMaturity; }
    public BigDecimal getBaseYield() { return baseYield; }
    public void setBaseYield(BigDecimal baseYield) { this.baseYield = baseYield; }
}
