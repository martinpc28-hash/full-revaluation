package com.martin.fullreval.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * One market scenario = one shocked state of the world.
 * A "scenario set" (e.g. 250 historical daily moves) is just
 * many rows of this table sharing the same SCENARIO_SET_ID.
 */
@Entity
@Table(name = "MARKET_SCENARIOS")
public class MarketScenario {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "scenario_seq")
    @SequenceGenerator(name = "scenario_seq", sequenceName = "SCENARIO_SEQ", allocationSize = 1)
    @Column(name = "SCENARIO_ID")
    private Long id;

    @Column(name = "SCENARIO_SET_ID", nullable = false)
    private String scenarioSetId;

    @Column(name = "SCENARIO_DATE")
    private LocalDate scenarioDate; // e.g. the historical date this shock was observed

    @Column(name = "RATE_SHOCK_BP", precision = 9, scale = 4)
    private BigDecimal rateShockBp; // parallel shift, in basis points

    @Column(name = "SPOT_SHOCK_PCT", precision = 9, scale = 6)
    private BigDecimal spotShockPct; // e.g. -0.02 = -2%

    @Column(name = "VOL_SHOCK_ABS", precision = 9, scale = 6)
    private BigDecimal volShockAbs; // absolute vol points, e.g. 0.01 = +1 vol point

    @Column(name = "FX_SHOCK_PCT", precision = 9, scale = 6)
    private BigDecimal fxShockPct = BigDecimal.ZERO; // e.g. -0.01 = local currency depreciates 1% vs USD

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getScenarioSetId() { return scenarioSetId; }
    public void setScenarioSetId(String scenarioSetId) { this.scenarioSetId = scenarioSetId; }
    public LocalDate getScenarioDate() { return scenarioDate; }
    public void setScenarioDate(LocalDate scenarioDate) { this.scenarioDate = scenarioDate; }
    public BigDecimal getRateShockBp() { return rateShockBp; }
    public void setRateShockBp(BigDecimal rateShockBp) { this.rateShockBp = rateShockBp; }
    public BigDecimal getSpotShockPct() { return spotShockPct; }
    public void setSpotShockPct(BigDecimal spotShockPct) { this.spotShockPct = spotShockPct; }
    public BigDecimal getVolShockAbs() { return volShockAbs; }
    public void setVolShockAbs(BigDecimal volShockAbs) { this.volShockAbs = volShockAbs; }
    public BigDecimal getFxShockPct() { return fxShockPct; }
    public void setFxShockPct(BigDecimal fxShockPct) { this.fxShockPct = fxShockPct; }
}
