package com.martin.fullreval.model;

import jakarta.persistence.*;
import java.math.BigDecimal;

/**
 * One row per (instrument, scenario): base value, revalued value, P&L.
 * This is the table that grows large (instruments x scenarios) and is
 * written in batches, mirroring how a real Full Revaluation batch job
 * would populate an Oracle results table overnight.
 */
@Entity
@Table(name = "REVALUATION_RESULTS")
public class RevaluationResult {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "result_seq")
    @SequenceGenerator(name = "result_seq", sequenceName = "RESULT_SEQ", allocationSize = 50)
    @Column(name = "RESULT_ID")
    private Long id;

    @Column(name = "RUN_ID", nullable = false)
    private String runId;

    @Column(name = "INSTRUMENT_ID", nullable = false)
    private Long instrumentId;

    @Column(name = "SCENARIO_ID", nullable = false)
    private Long scenarioId;

    @Column(name = "BASE_VALUE", precision = 18, scale = 4)
    private BigDecimal baseValue;

    @Column(name = "REVALUED_VALUE", precision = 18, scale = 4)
    private BigDecimal revaluedValue;

    @Column(name = "PNL", precision = 18, scale = 4)
    private BigDecimal pnl;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getRunId() { return runId; }
    public void setRunId(String runId) { this.runId = runId; }
    public Long getInstrumentId() { return instrumentId; }
    public void setInstrumentId(Long instrumentId) { this.instrumentId = instrumentId; }
    public Long getScenarioId() { return scenarioId; }
    public void setScenarioId(Long scenarioId) { this.scenarioId = scenarioId; }
    public BigDecimal getBaseValue() { return baseValue; }
    public void setBaseValue(BigDecimal baseValue) { this.baseValue = baseValue; }
    public BigDecimal getRevaluedValue() { return revaluedValue; }
    public void setRevaluedValue(BigDecimal revaluedValue) { this.revaluedValue = revaluedValue; }
    public BigDecimal getPnl() { return pnl; }
    public void setPnl(BigDecimal pnl) { this.pnl = pnl; }
}
