package com.martin.fullreval.controller;

import com.martin.fullreval.dto.CustomScenarioRequest;
import com.martin.fullreval.model.MarketScenario;
import com.martin.fullreval.repository.MarketScenarioRepository;
import com.martin.fullreval.service.HistoricalScenarioService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;

@RestController
@RequestMapping("/api/scenarios")
public class ScenarioController {

    private final MarketScenarioRepository scenarioRepository;
    private final HistoricalScenarioService historicalScenarioService;

    public ScenarioController(MarketScenarioRepository scenarioRepository,
                               HistoricalScenarioService historicalScenarioService) {
        this.scenarioRepository = scenarioRepository;
        this.historicalScenarioService = historicalScenarioService;
    }

    /**
     * Generates a SYNTHETIC scenario set — random Gaussian noise, not real market
     * moves. Useful when you have no network access to a data source, or just want
     * a quick end-to-end smoke test. For anything you actually want to trust,
     * use /generate-historical instead.
     */
    @PostMapping("/generate")
    public List<MarketScenario> generateScenarioSet(@RequestParam String scenarioSetId,
                                                      @RequestParam(defaultValue = "250") int count) {
        Random random = new Random(42); // fixed seed: reproducible demo runs
        List<MarketScenario> scenarios = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            MarketScenario s = new MarketScenario();
            s.setScenarioSetId(scenarioSetId);
            s.setScenarioDate(LocalDate.now().minusDays(count - i));
            s.setRateShockBp(BigDecimal.valueOf(random.nextGaussian() * 15)); // ~15bp daily vol
            s.setSpotShockPct(BigDecimal.valueOf(random.nextGaussian() * 0.015)); // ~1.5% daily vol
            s.setVolShockAbs(BigDecimal.valueOf(random.nextGaussian() * 0.01)); // ~1 vol point
            s.setFxShockPct(BigDecimal.valueOf(random.nextGaussian() * 0.008)); // ~0.8% daily FX vol vs USD
            scenarios.add(s);
        }
        return scenarioRepository.saveAll(scenarios);
    }

    @GetMapping("/{scenarioSetId}")
    public List<MarketScenario> getScenarioSet(@PathVariable String scenarioSetId) {
        return scenarioRepository.findByScenarioSetId(scenarioSetId);
    }

    /**
     * Generates a scenario set from REAL historical daily market data (FRED:
     * 10-Year Treasury, S&P 500, VIX, USD/EUR) — each scenario is one real
     * trading day's actual move, not a random draw. This is what makes the
     * resulting VaR mean something. See HistoricalScenarioService for the
     * caveats that still apply (one shared shock per scenario, no per-instrument
     * risk factors or cross-factor correlation).
     */
    @PostMapping("/generate-historical")
    public List<MarketScenario> generateHistoricalScenarioSet(@RequestParam String scenarioSetId,
                                                                @RequestParam(defaultValue = "250") int count) {
        return historicalScenarioService.buildHistoricalScenarioSet(scenarioSetId, count);
    }

    /**
     * A single, deterministic macro shock defined by the user (e.g. "+100bp rates" or
     * "oil shock"), as opposed to the random scenario set above. Saved as a
     * one-scenario set so it can be run through the same full-revaluation pipeline.
     */
    @PostMapping("/custom")
    public MarketScenario createCustomScenario(@RequestBody CustomScenarioRequest req) {
        MarketScenario s = new MarketScenario();
        s.setScenarioSetId(req.scenarioSetId != null && !req.scenarioSetId.isBlank()
                ? req.scenarioSetId
                : "stress-" + System.currentTimeMillis());
        s.setScenarioDate(LocalDate.now());
        s.setRateShockBp(req.rateShockBp);
        s.setSpotShockPct(req.spotShockPct);
        s.setVolShockAbs(req.volShockAbs);
        s.setFxShockPct(req.fxShockPct);
        return scenarioRepository.save(s);
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, String>> handleDataSourceFailure(IllegalStateException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", e.getMessage()));
    }
}
