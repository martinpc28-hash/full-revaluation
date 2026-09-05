package com.martin.fullreval.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Real per-ticker historical stock data, straight from Yahoo Finance's public
 * chart API (the same endpoint the Python `yfinance` package calls under the
 * hood — no official SDK, no API key). Used to give each Equity instrument its
 * OWN real day-over-day return series, instead of sharing the portfolio-wide
 * S&P 500 spot shock (from HistoricalScenarioService/FRED) with every equity
 * regardless of what it actually is. Bonds and options still use the shared
 * FRED-based factors — this only narrows the "one shock fits all" gap for
 * equities, it doesn't remove it for the rest of the engine.
 *
 * Equity.getName() doubles as the Yahoo ticker (e.g. "AAPL", "MSFT") — enter
 * a real ticker there, not a free-text label, or this silently finds nothing
 * and the engine falls back to the shared spot shock for that position.
 */
@Service
public class YahooFinanceService {

    private static final Logger log = LoggerFactory.getLogger(YahooFinanceService.class);
    private static final String CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
    private static final Duration TIMEOUT = Duration.ofSeconds(10);
    private static final Duration CACHE_TTL = Duration.ofHours(1);

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();

    public YahooFinanceService() {
        // Forced HTTP/1.1 defensively: FRED's CDN (Akamai) silently hangs Java's
        // default HTTP/2 client (see HistoricalScenarioService); Yahoo sits behind
        // similar infra, so avoid the same class of bug pre-emptively.
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(TIMEOUT)
                .build();
    }

    /**
     * Day-over-day return series for a ticker, keyed by trading date, covering
     * roughly the last year. Returns an empty map (never null, never throws) if
     * the ticker is invalid or Yahoo can't be reached — callers should treat
     * "no data" as "fall back to the shared shock", not as an error.
     */
    public Map<LocalDate, BigDecimal> fetchDailyReturns(String ticker) {
        String key = ticker.trim().toUpperCase();
        CacheEntry cached = cache.get(key);
        if (cached != null && cached.fetchedAt.plus(CACHE_TTL).isAfter(Instant.now())) {
            return cached.returns;
        }

        Map<LocalDate, BigDecimal> returns;
        try {
            returns = fetchFromYahoo(key);
        } catch (Exception e) {
            log.warn("Could not fetch Yahoo Finance data for ticker '{}': {}", key, e.getMessage());
            returns = Map.of();
        }
        cache.put(key, new CacheEntry(returns, Instant.now()));
        return returns;
    }

    private Map<LocalDate, BigDecimal> fetchFromYahoo(String ticker) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(CHART_URL + ticker + "?range=1y&interval=1d"))
                .timeout(TIMEOUT)
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")
                .GET()
                .build();

        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IOException("Yahoo Finance returned HTTP " + response.statusCode() + " for " + ticker);
        }

        JsonNode root = objectMapper.readTree(response.body());
        JsonNode result = root.path("chart").path("result");
        if (!result.isArray() || result.isEmpty()) {
            JsonNode error = root.path("chart").path("error");
            throw new IOException("Yahoo Finance has no data for '" + ticker + "'"
                    + (error.isMissingNode() ? "" : ": " + error.path("description").asText(error.toString())));
        }

        JsonNode timestamps = result.get(0).path("timestamp");
        JsonNode closes = result.get(0).path("indicators").path("quote").get(0).path("close");

        TreeMap<LocalDate, BigDecimal> closesByDate = new TreeMap<>();
        for (int i = 0; i < timestamps.size(); i++) {
            JsonNode closeNode = closes.get(i);
            if (closeNode == null || closeNode.isNull()) continue; // non-trading day / halt
            LocalDate date = Instant.ofEpochSecond(timestamps.get(i).asLong()).atZone(ZoneOffset.UTC).toLocalDate();
            closesByDate.put(date, BigDecimal.valueOf(closeNode.asDouble()));
        }

        Map<LocalDate, BigDecimal> returns = new TreeMap<>();
        LocalDate[] dates = closesByDate.keySet().toArray(new LocalDate[0]);
        for (int i = 1; i < dates.length; i++) {
            BigDecimal prev = closesByDate.get(dates[i - 1]);
            BigDecimal today = closesByDate.get(dates[i]);
            returns.put(dates[i], today.subtract(prev).divide(prev, MathContext.DECIMAL64));
        }
        return returns;
    }

    private record CacheEntry(Map<LocalDate, BigDecimal> returns, Instant fetchedAt) {}
}
