package com.martin.fullreval.controller;

import com.martin.fullreval.service.RevaluationService;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/revaluation")
public class RevaluationController {

    private final RevaluationService revaluationService;

    public RevaluationController(RevaluationService revaluationService) {
        this.revaluationService = revaluationService;
    }

    @PostMapping("/run")
    public Map<String, String> run(@RequestParam Long portfolioId, @RequestParam String scenarioSetId) {
        String runId = revaluationService.runFullRevaluation(portfolioId, scenarioSetId);
        return Map.of("runId", runId);
    }

    @GetMapping("/{runId}/var")
    public Map<String, Object> getVaR(@PathVariable String runId,
                                       @RequestParam(defaultValue = "0.99") double confidence) {
        BigDecimal var = revaluationService.calculateVaR(runId, confidence);
        return Map.of("runId", runId, "confidence", confidence, "var", var);
    }

    /** Portfolio P&L per scenario for this run — the data behind the VaR figure. */
    @GetMapping("/{runId}/pnl-distribution")
    public List<Map<String, Object>> pnlDistribution(@PathVariable String runId) {
        return revaluationService.getPnlDistribution(runId);
    }

    /** Per-instrument P&L for this run — which positions drive the result. */
    @GetMapping("/{runId}/instrument-breakdown")
    public List<Map<String, Object>> instrumentBreakdown(@PathVariable String runId) {
        return revaluationService.getInstrumentBreakdown(runId);
    }
}
