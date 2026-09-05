package com.martin.fullreval.service;

import com.martin.fullreval.model.*;
import com.martin.fullreval.repository.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;

/**
 * Orchestrates a Full Revaluation run:
 *   for each instrument in the portfolio, for each scenario in the set,
 *   recompute the instrument's exact price (not a sensitivity approximation)
 *   and store the P&L.
 *
 * This mirrors the nightly batch job a bank's risk system runs; here it's
 * exposed synchronously via REST for demo purposes, but instrument x scenario
 * pricing is parallelized since that's the computationally heavy part in
 * a real Full Revaluation engine.
 */
@Service
public class RevaluationService {

    private final InstrumentRepository instrumentRepository;
    private final MarketScenarioRepository scenarioRepository;
    private final RevaluationResultRepository resultRepository;
    private final YahooFinanceService yahooFinanceService;

    private static final int BATCH_SIZE = 500;

    @Autowired
    public RevaluationService(InstrumentRepository instrumentRepository,
                               MarketScenarioRepository scenarioRepository,
                               RevaluationResultRepository resultRepository,
                               YahooFinanceService yahooFinanceService) {
        this.instrumentRepository = instrumentRepository;
        this.scenarioRepository = scenarioRepository;
        this.resultRepository = resultRepository;
        this.yahooFinanceService = yahooFinanceService;
    }

    @Transactional
    public String runFullRevaluation(Long portfolioId, String scenarioSetId) {
        String runId = UUID.randomUUID().toString();

        List<Instrument> instruments = instrumentRepository.findByPortfolioId(portfolioId);
        List<MarketScenario> scenarios = scenarioRepository.findByScenarioSetId(scenarioSetId);

        // Base value uses a "no shock" scenario (all shocks zero) for comparison.
        MarketScenario baseScenario = zeroShockScenario();

        // Real per-ticker returns for every equity in this portfolio, fetched once
        // up front (not per scenario) — see YahooFinanceService for why this exists:
        // without it, every equity shares the portfolio-wide S&P 500 spot shock
        // regardless of what the position actually is. Bonds/options are unaffected.
        Map<String, Map<LocalDate, BigDecimal>> equityReturnsByTicker = new HashMap<>();
        for (Instrument instrument : instruments) {
            if (instrument instanceof Equity equity) {
                equityReturnsByTicker.computeIfAbsent(equity.getName(), yahooFinanceService::fetchDailyReturns);
            }
        }

        List<RevaluationResult> buffer = new ArrayList<>(BATCH_SIZE);

        // Parallelize the instrument x scenario grid: this is the part that's
        // computationally heavy in a real bank (millions of reprices per run),
        // so it's the natural place to fan out to threads, or later, to
        // AWS Batch / Lambda workers instead of a single JVM.
        List<CompletableFuture<RevaluationResult>> futures = new ArrayList<>();
        for (Instrument instrument : instruments) {
            BigDecimal baseValue = instrument.priceInBaseCurrency(baseScenario);
            Map<LocalDate, BigDecimal> tickerReturns =
                    instrument instanceof Equity e ? equityReturnsByTicker.get(e.getName()) : null;

            for (MarketScenario scenario : scenarios) {
                // If we have a REAL return for this equity on this exact date, use it
                // instead of the scenario's shared spot shock. Falls back silently
                // (null lookup) for bonds, options, unknown tickers, or synthetic/
                // stress scenarios whose dates don't correspond to real trading days.
                MarketScenario effectiveScenario = scenario;
                if (tickerReturns != null) {
                    BigDecimal realReturn = tickerReturns.get(scenario.getScenarioDate());
                    if (realReturn != null) {
                        effectiveScenario = withSpotOverride(scenario, realReturn);
                    }
                }
                final MarketScenario scenarioForPricing = effectiveScenario;

                futures.add(CompletableFuture.supplyAsync(() -> {
                    BigDecimal revalued = instrument.priceInBaseCurrency(scenarioForPricing);
                    RevaluationResult result = new RevaluationResult();
                    result.setRunId(runId);
                    result.setInstrumentId(instrument.getId());
                    result.setScenarioId(scenario.getId());
                    result.setBaseValue(baseValue);
                    result.setRevaluedValue(revalued);
                    result.setPnl(revalued.subtract(baseValue));
                    return result;
                }));
            }
        }

        for (CompletableFuture<RevaluationResult> future : futures) {
            buffer.add(future.join());
            if (buffer.size() >= BATCH_SIZE) {
                resultRepository.saveAll(buffer);
                buffer.clear();
            }
        }
        if (!buffer.isEmpty()) {
            resultRepository.saveAll(buffer);
        }

        return runId;
    }

    /** Portfolio-level VaR at the given confidence (e.g. 0.99) from a completed run. */
    public BigDecimal calculateVaR(String runId, double confidence) {
        List<RevaluationResult> results = resultRepository.findByRunId(runId);

        // Aggregate P&L per scenario across all instruments (portfolio P&L per scenario).
        var pnlByScenario = results.stream()
                .collect(Collectors.groupingBy(RevaluationResult::getScenarioId,
                        Collectors.reducing(BigDecimal.ZERO, RevaluationResult::getPnl, BigDecimal::add)));

        List<BigDecimal> losses = pnlByScenario.values().stream()
                .sorted()
                .collect(Collectors.toList());

        if (losses.isEmpty()) {
            return BigDecimal.ZERO;
        }

        int index = (int) Math.floor((1 - confidence) * losses.size());
        index = Math.max(0, Math.min(index, losses.size() - 1));

        // VaR is reported as a positive loss number.
        return losses.get(index).negate().max(BigDecimal.ZERO);
    }

    /** A copy of `base` with its spot shock replaced — used to splice in a real
     * per-ticker return for one equity without mutating the shared, persisted
     * scenario (which every other instrument in the run still needs unchanged). */
    private MarketScenario withSpotOverride(MarketScenario base, BigDecimal spotShockOverride) {
        MarketScenario copy = new MarketScenario();
        copy.setScenarioSetId(base.getScenarioSetId());
        copy.setScenarioDate(base.getScenarioDate());
        copy.setRateShockBp(base.getRateShockBp());
        copy.setSpotShockPct(spotShockOverride);
        copy.setVolShockAbs(base.getVolShockAbs());
        copy.setFxShockPct(base.getFxShockPct());
        return copy;
    }

    private MarketScenario zeroShockScenario() {
        MarketScenario base = new MarketScenario();
        base.setRateShockBp(BigDecimal.ZERO);
        base.setSpotShockPct(BigDecimal.ZERO);
        base.setVolShockAbs(BigDecimal.ZERO);
        base.setFxShockPct(BigDecimal.ZERO);
        return base;
    }

    /**
     * Portfolio P&L per scenario for a completed run, enriched with the scenario's
     * own shocks so each row is self-explanatory (what moved, and what it cost/made).
     * Sorted ascending by P&L so the worst scenarios (the VaR tail) show up first.
     */
    public List<Map<String, Object>> getPnlDistribution(String runId) {
        List<RevaluationResult> results = resultRepository.findByRunId(runId);

        Map<Long, BigDecimal> pnlByScenario = results.stream()
                .collect(Collectors.groupingBy(RevaluationResult::getScenarioId,
                        Collectors.reducing(BigDecimal.ZERO, RevaluationResult::getPnl, BigDecimal::add)));

        Map<Long, MarketScenario> scenarioMap = scenarioRepository.findAllById(pnlByScenario.keySet()).stream()
                .collect(Collectors.toMap(MarketScenario::getId, s -> s));

        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map.Entry<Long, BigDecimal> entry : pnlByScenario.entrySet()) {
            MarketScenario s = scenarioMap.get(entry.getKey());
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("scenarioId", entry.getKey());
            row.put("scenarioDate", s != null ? s.getScenarioDate() : null);
            row.put("rateShockBp", s != null ? s.getRateShockBp() : null);
            row.put("spotShockPct", s != null ? s.getSpotShockPct() : null);
            row.put("volShockAbs", s != null ? s.getVolShockAbs() : null);
            row.put("fxShockPct", s != null ? s.getFxShockPct() : null);
            row.put("pnl", entry.getValue());
            rows.add(row);
        }
        rows.sort(Comparator.comparing(m -> (BigDecimal) m.get("pnl")));
        return rows;
    }

    /**
     * Per-instrument P&L for a run, summed across every scenario in that run's set
     * (for a one-scenario stress test this is simply that scenario's impact per
     * instrument — exactly "which position hurts/helps under this shock").
     * Sorted ascending by P&L so the worst-hit instruments show up first.
     */
    public List<Map<String, Object>> getInstrumentBreakdown(String runId) {
        List<RevaluationResult> results = resultRepository.findByRunId(runId);

        Map<Long, List<RevaluationResult>> byInstrument = results.stream()
                .collect(Collectors.groupingBy(RevaluationResult::getInstrumentId));

        Map<Long, Instrument> instrumentMap = instrumentRepository.findAllById(byInstrument.keySet()).stream()
                .collect(Collectors.toMap(Instrument::getId, i -> i));

        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map.Entry<Long, List<RevaluationResult>> entry : byInstrument.entrySet()) {
            Instrument instrument = instrumentMap.get(entry.getKey());
            BigDecimal baseValue = entry.getValue().stream().map(RevaluationResult::getBaseValue)
                    .reduce(BigDecimal.ZERO, BigDecimal::add)
                    .divide(BigDecimal.valueOf(entry.getValue().size()), java.math.MathContext.DECIMAL64);
            BigDecimal pnl = entry.getValue().stream().map(RevaluationResult::getPnl)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("instrumentId", entry.getKey());
            row.put("name", instrument != null ? instrument.getName() : "(deleted)");
            row.put("type", instrument == null ? "?"
                    : instrument instanceof Bond ? "BOND"
                    : instrument instanceof EuropeanOption ? "OPTION"
                    : instrument instanceof Equity ? "EQUITY" : "?");
            row.put("baseValue", baseValue);
            row.put("pnl", pnl);
            rows.add(row);
        }
        rows.sort(Comparator.comparing(m -> (BigDecimal) m.get("pnl")));
        return rows;
    }
}
