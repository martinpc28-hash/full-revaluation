package com.martin.fullreval.model;

import jakarta.persistence.*;
import java.math.BigDecimal;

/**
 * Base class for anything that can be priced.
 * Uses SINGLE_TABLE inheritance so Oracle stores bonds and options
 * in one INSTRUMENTS table, discriminated by INSTRUMENT_TYPE.
 */
@Entity
@Table(name = "INSTRUMENTS")
@Inheritance(strategy = InheritanceType.SINGLE_TABLE)
@DiscriminatorColumn(name = "INSTRUMENT_TYPE", discriminatorType = DiscriminatorType.STRING)
public abstract class Instrument {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "instrument_seq")
    @SequenceGenerator(name = "instrument_seq", sequenceName = "INSTRUMENT_SEQ", allocationSize = 1)
    @Column(name = "INSTRUMENT_ID")
    private Long id;

    @Column(name = "NAME", nullable = false)
    private String name;

    @Column(name = "NOTIONAL", nullable = false, precision = 18, scale = 4)
    private BigDecimal notional;

    @Column(name = "PORTFOLIO_ID", nullable = false)
    private Long portfolioId;

    // Base (reporting) currency is USD. An instrument booked in another currency
    // carries the FX rate to USD as of t0, so a scenario's fxShockPct can reprice
    // the FX leg alongside the instrument's own market risk.
    @Column(name = "CURRENCY", nullable = false, length = 3)
    private String currency = "USD";

    @Column(name = "BASE_FX_RATE", precision = 18, scale = 6)
    private BigDecimal baseFxRate = BigDecimal.ONE; // units of USD per 1 unit of `currency`

    // Every instrument must know how to price itself given a shocked market scenario,
    // in its OWN currency.
    public abstract BigDecimal priceUnderScenario(MarketScenario scenario);

    /** Price under the scenario, converted to the portfolio's base currency (USD). */
    public BigDecimal priceInBaseCurrency(MarketScenario scenario) {
        BigDecimal localValue = priceUnderScenario(scenario);
        if (currency == null || "USD".equalsIgnoreCase(currency)) {
            return localValue; // already in base currency, no FX risk
        }
        BigDecimal fxRate = (baseFxRate == null ? BigDecimal.ONE : baseFxRate);
        BigDecimal shockedFx = fxRate.multiply(BigDecimal.ONE.add(scenario.getFxShockPct()));
        return localValue.multiply(shockedFx);
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public BigDecimal getNotional() { return notional; }
    public void setNotional(BigDecimal notional) { this.notional = notional; }
    public Long getPortfolioId() { return portfolioId; }
    public void setPortfolioId(Long portfolioId) { this.portfolioId = portfolioId; }
    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public BigDecimal getBaseFxRate() { return baseFxRate; }
    public void setBaseFxRate(BigDecimal baseFxRate) { this.baseFxRate = baseFxRate; }
}
