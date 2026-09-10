package com.martin.fullreval.service;

import com.martin.fullreval.model.MarketScenario;
import com.martin.fullreval.repository.MarketScenarioRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.MathContext;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Builds a market scenario set from REAL historical daily market data instead
 * of synthetic random noise (see ScenarioController#generateScenarioSet).
 *
 * Source: FRED (Federal Reserve Economic Data), the Fed's free public
 * data API — via FredClient. Four series cover the four risk factors this
 * engine already models:
 *   - DGS10   10-Year Treasury yield        -> rate shock (bp)
 *   - SP500   S&P 500 index level           -> equity spot shock (%)
 *   - VIXCLS  CBOE Volatility Index         -> vol shock (points)
 *   - DEXUSEU USD per EUR exchange rate     -> FX shock (%)
 *
 * Each scenario is one real trading day's actual day-over-day move. This is
 * still a simplification the rest of the engine shares: ONE common shock is
 * applied to every instrument regardless of its own currency or market (a
 * bond, an option and a stock all see the same "spot shock", for example) —
 * real market data doesn't fix that; only per-instrument risk factors and a
 * correlation structure would. See README for that caveat.
 */
@Service
public class HistoricalScenarioService {

    private final MarketScenarioRepository scenarioRepository;
    private final FredClient fredClient;

    public HistoricalScenarioService(MarketScenarioRepository scenarioRepository, FredClient fredClient) {
        this.scenarioRepository = scenarioRepository;
        this.fredClient = fredClient;
    }

    public List<MarketScenario> buildHistoricalScenarioSet(String scenarioSetId, int count) {
        Map<LocalDate, BigDecimal> rates = fredClient.fetchSeries("DGS10");
        Map<LocalDate, BigDecimal> spot = fredClient.fetchSeries("SP500");
        Map<LocalDate, BigDecimal> vol = fredClient.fetchSeries("VIXCLS");
        Map<LocalDate, BigDecimal> fx = fredClient.fetchSeries("DEXUSEU");

        // Only keep dates where all four series actually published a value —
        // different series can have different holiday calendars/release gaps.
        List<LocalDate> commonDates = new ArrayList<>(rates.keySet());
        commonDates.retainAll(spot.keySet());
        commonDates.retainAll(vol.keySet());
        commonDates.retainAll(fx.keySet());
        commonDates.sort(LocalDate::compareTo);

        if (commonDates.size() < count + 1) {
            throw new IllegalStateException(
                    "Only " + Math.max(0, commonDates.size() - 1) + " days of overlapping real market data " +
                    "available across DGS10/SP500/VIXCLS/DEXUSEU, need " + count + ". Try a smaller count.");
        }

        // Day-over-day change needs a "previous day" reference, so we need
        // count+1 dates to produce `count` shock scenarios.
        List<LocalDate> window = commonDates.subList(commonDates.size() - (count + 1), commonDates.size());

        List<MarketScenario> scenarios = new ArrayList<>();
        for (int i = 1; i < window.size(); i++) {
            LocalDate today = window.get(i);
            LocalDate prev = window.get(i - 1);

            BigDecimal rateShockBp = rates.get(today).subtract(rates.get(prev))
                    .multiply(BigDecimal.valueOf(100)); // percentage points -> bp
            BigDecimal spotShockPct = pctChange(spot.get(prev), spot.get(today));
            BigDecimal volShockAbs = vol.get(today).subtract(vol.get(prev))
                    .divide(BigDecimal.valueOf(100), MathContext.DECIMAL64); // vol points -> fraction
            BigDecimal fxShockPct = pctChange(fx.get(prev), fx.get(today));

            MarketScenario s = new MarketScenario();
            s.setScenarioSetId(scenarioSetId);
            s.setScenarioDate(today);
            s.setRateShockBp(rateShockBp);
            s.setSpotShockPct(spotShockPct);
            s.setVolShockAbs(volShockAbs);
            s.setFxShockPct(fxShockPct);
            scenarios.add(s);
        }

        return scenarioRepository.saveAll(scenarios);
    }

    private BigDecimal pctChange(BigDecimal from, BigDecimal to) {
        return to.subtract(from).divide(from, MathContext.DECIMAL64);
    }
}
