package com.martin.fullreval.service;

import org.springframework.stereotype.Service;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Thin client for FRED's (Federal Reserve Economic Data) free, no-API-key CSV
 * endpoint. Shared by HistoricalScenarioService (rates/S&P500/VIX/FX shocks)
 * and FxRateService (currency conversion for the seasonality module) so the
 * HTTP quirks below only need to be solved once.
 */
@Service
public class FredClient {

    private static final String CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=";
    private static final Duration TIMEOUT = Duration.ofSeconds(15);
    private static final Duration CACHE_TTL = Duration.ofHours(1);

    private final HttpClient httpClient;
    private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();

    public FredClient() {
        // HTTP/1.1 forced: the JDK's HTTP/2 client occasionally gets RST_STREAM
        // "internal error" against FRED's server for reasons unrelated to this app.
        this.httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(TIMEOUT)
                .build();
    }

    /** Every published (date, value) point for a FRED series, oldest first. Cached 1h. */
    public Map<LocalDate, BigDecimal> fetchSeries(String seriesId) {
        CacheEntry cached = cache.get(seriesId);
        if (cached != null && cached.fetchedAt.plus(CACHE_TTL).isAfter(java.time.Instant.now())) {
            return cached.series;
        }

        // Akamai (FRED's CDN) silently black-holes this request (hangs until
        // timeout, no RST/error) with a browser-claiming User-Agent — almost
        // certainly a bot-detection mismatch between a JDK TLS fingerprint and a
        // "Chrome" UA string. Claiming to be curl instead (still HTTP/1.1, forced
        // in the constructor above) is what actually gets a real response.
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(CSV_URL + seriesId))
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
        cache.put(seriesId, new CacheEntry(series, java.time.Instant.now()));
        return series;
    }

    private record CacheEntry(Map<LocalDate, BigDecimal> series, java.time.Instant fetchedAt) {}
}
