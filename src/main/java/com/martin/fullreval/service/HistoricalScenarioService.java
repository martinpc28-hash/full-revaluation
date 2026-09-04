package com.martin.fullreval.service;

import com.martin.fullreval.model.MarketScenario;
import com.martin.fullreval.repository.MarketScenarioRepository;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Builds a market scenario set from REAL historical daily market data instead
 * of synthetic random noise (see ScenarioController#generateScenarioSet).
 *
 * Source: FRED (Federal Reserve Economic Data), the Fed's free public
 * data API. No API key or account needed — the graph/fredgraph.csv endpoint
 * serves plain CSV. Four series cover the four risk factors this engine
 * already models:
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

    private static final String FRED_CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=";
    private static final Duration TIMEOUT = Duration.ofSeconds(15);

    private final MarketScenarioRepository scenarioRepository;
    private final HttpClient httpClient;

    public HistoricalScenarioService(MarketScenarioRepository scenarioRepository) {
        this.scenarioRepository = scenarioRepository;
        // HTTP/1.1 forced: the JDK's HTTP/2 client occasionally gets RST_STREAM
        // "internal error" against FRED's server for reasons unrelated to this app.
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(TIMEOUT)
                .build();
    }

    public List<MarketScenario> buildHistoricalScenarioSet(String scenarioSetId, int count) {
        Map<LocalDate, BigDecimal> rates = fetchSeries("DGS10");
        Map<LocalDate, BigDecimal> spot = fetchSeries("SP500");
        Map<LocalDate, BigDecimal> vol = fetchSeries("VIXCLS");
        Map<LocalDate, BigDecimal> fx = fetchSeries("DEXUSEU");

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

    private Map<LocalDate, BigDecimal> fetchSeries(String seriesId) {
        // Akamai (FRED's CDN) silently black-holes this request (hangs until
        // timeout, no RST/error) with a browser-claiming User-Agent — almost
        // certainly a bot-detection mismatch between a JDK TLS fingerprint and a
        // "Chrome" UA string. Claiming to be curl instead (still HTTP/1.1, forced
        // in the constructor above) is what actually gets a real response.
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(FRED_CSV_URL + seriesId))
                .timeout(TIMEOUT)
                .header("User-Agent", "curl/8.5.0")
                .GET()
                .build();

        HttpResponse<String> response;
        try {
            response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException | InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Could not reach FRED for series " + seriesId + ": " + e.getMessage(), e);
        }
        if (response.statusCode() != 200) {
            throw new IllegalStateException("FRED returned HTTP " + response.statusCode() + " for series " + seriesId);
        }

        Map<LocalDate, BigDecimal> series = new TreeMap<>();
        String[] lines = response.body().split("\n");
        for (int i = 1; i < lines.length; i++) { // line 0 is the header
            String line = lines[i].trim();
            if (line.isEmpty()) continue;
            int comma = line.indexOf(',');
            if (comma < 0) continue;
            String dateStr = line.substring(0, comma);
            String valueStr = line.substring(comma + 1).trim();
            if (valueStr.isEmpty() || valueStr.equals(".")) continue; // FRED's "no data published" marker
            try {
                series.put(LocalDate.parse(dateStr), new BigDecimal(valueStr));
            } catch (RuntimeException ignored) {
                // Skip any malformed row rather than failing the whole fetch.
            }
        }
        if (series.isEmpty()) {
            throw new IllegalStateException("FRED series " + seriesId + " returned no usable data");
        }
        return series;
    }
}
