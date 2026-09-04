package com.martin.fullreval.model;

import jakarta.persistence.Column;
import jakarta.persistence.DiscriminatorValue;
import jakarta.persistence.Entity;
import java.math.BigDecimal;

/**
 * A plain equity (stock) position. Full revaluation here is linear —
 * no optionality, no discounting — the position is simply repriced at
 * the shocked spot: value = shares x shockedSpot. Column names are
 * prefixed EQ_ to avoid clashing with EuropeanOption's own BASE_SPOT
 * column in the shared SINGLE_TABLE.
 */
@Entity
@DiscriminatorValue("EQUITY")
public class Equity extends Instrument {

    @Column(name = "SHARES", precision = 18, scale = 4)
    private BigDecimal shares;

    @Column(name = "EQ_BASE_SPOT", precision = 18, scale = 4)
    private BigDecimal baseSpot;

    @Override
    public BigDecimal priceUnderScenario(MarketScenario scenario) {
        BigDecimal shockedSpot = baseSpot.multiply(BigDecimal.ONE.add(scenario.getSpotShockPct()));
        return shares.multiply(shockedSpot);
    }

    public BigDecimal getShares() { return shares; }
    public void setShares(BigDecimal shares) { this.shares = shares; }
    public BigDecimal getBaseSpot() { return baseSpot; }
    public void setBaseSpot(BigDecimal baseSpot) { this.baseSpot = baseSpot; }
}
