package com.martin.fullreval.service;

import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.MathContext;
import java.time.LocalDate;
import java.util.Map;
import java.util.NavigableMap;
import java.util.TreeMap;

/**
 * Converts USD prices to local currency for the seasonality module's "moneda
 * local" mode, using FRED's free daily FX series — the same client
 * HistoricalScenarioService uses. FRED quotes each pair in whichever
 * direction is conventional for that currency (e.g. Yen per USD, but USD per
 * Euro) — CurrencySeries below records which, so callers always get a
 * consistent "USD per 1 unit of local currency" rate out of getUsdPerLocal,
 * matching the same convention Instrument.baseFxRate already uses elsewhere
 * in this codebase.
 */
@Service
public class FxRateService {

    private enum Quote { USD_PER_LOCAL, LOCAL_PER_USD }

    private record CurrencySeries(String fredSeriesId, Quote quote) {}

    private static final Map<String, CurrencySeries> SERIES = Map.ofEntries(
            Map.entry("EUR", new CurrencySeries("DEXUSEU", Quote.USD_PER_LOCAL)),
            Map.entry("GBP", new CurrencySeries("DEXUSUK", Quote.USD_PER_LOCAL)),
            Map.entry("AUD", new CurrencySeries("DEXUSAL", Quote.USD_PER_LOCAL)),
            Map.entry("JPY", new CurrencySeries("DEXJPUS", Quote.LOCAL_PER_USD)),
            Map.entry("CAD", new CurrencySeries("DEXCAUS", Quote.LOCAL_PER_USD)),
            Map.entry("CHF", new CurrencySeries("DEXSZUS", Quote.LOCAL_PER_USD)),
            Map.entry("BRL", new CurrencySeries("DEXBZUS", Quote.LOCAL_PER_USD)),
            Map.entry("MXN", new CurrencySeries("DEXMXUS", Quote.LOCAL_PER_USD)),
            Map.entry("KRW", new CurrencySeries("DEXKOUS", Quote.LOCAL_PER_USD)),
            Map.entry("CNY", new CurrencySeries("DEXCHUS", Quote.LOCAL_PER_USD)),
            Map.entry("INR", new CurrencySeries("DEXINUS", Quote.LOCAL_PER_USD))
    );

    private final FredClient fredClient;

    public FxRateService(FredClient fredClient) {
        this.fredClient = fredClient;
    }

    /** True if this currency has a known FRED series — USD itself always does (rate = 1). */
    public boolean isSupported(String currencyCode) {
        return "USD".equalsIgnoreCase(currencyCode) || SERIES.containsKey(currencyCode.toUpperCase());
    }

    /** USD per 1 unit of `currencyCode`, by date. Empty/degenerate for USD (always 1) or an unknown currency. */
    public NavigableMap<LocalDate, BigDecimal> getUsdPerLocal(String currencyCode) {
        String code = currencyCode.toUpperCase();
        if ("USD".equals(code)) {
            return new TreeMap<>(); // callers treat "missing date" as 1:1 for USD — see convertToLocal
        }
        CurrencySeries cs = SERIES.get(code);
        if (cs == null) {
            return new TreeMap<>();
        }
        Map<LocalDate, BigDecimal> raw = fredClient.fetchSeries(cs.fredSeriesId());
        NavigableMap<LocalDate, BigDecimal> usdPerLocal = new TreeMap<>();
        for (Map.Entry<LocalDate, BigDecimal> e : raw.entrySet()) {
            BigDecimal value = e.getValue();
            BigDecimal converted = cs.quote() == Quote.USD_PER_LOCAL
                    ? value
                    : BigDecimal.ONE.divide(value, MathContext.DECIMAL64);
            usdPerLocal.put(e.getKey(), converted);
        }
        return usdPerLocal;
    }

    /**
     * Converts a USD close-price series to local currency, using the nearest
     * available FX rate on or before each price date (FX and equity/ETF
     * calendars don't perfectly align). If the currency is USD or unsupported,
     * returns the input unchanged.
     */
    public NavigableMap<LocalDate, BigDecimal> convertToLocal(NavigableMap<LocalDate, BigDecimal> usdCloses, String currencyCode) {
        if ("USD".equalsIgnoreCase(currencyCode) || !isSupported(currencyCode)) {
            return usdCloses;
        }
        NavigableMap<LocalDate, BigDecimal> usdPerLocal = getUsdPerLocal(currencyCode);
        if (usdPerLocal.isEmpty()) {
            return usdCloses;
        }
        NavigableMap<LocalDate, BigDecimal> result = new TreeMap<>();
        for (Map.Entry<LocalDate, BigDecimal> e : usdCloses.entrySet()) {
            Map.Entry<LocalDate, BigDecimal> fxEntry = usdPerLocal.floorEntry(e.getKey());
            if (fxEntry == null) continue; // no FX rate that far back — drop the point rather than guess
            result.put(e.getKey(), e.getValue().divide(fxEntry.getValue(), MathContext.DECIMAL64));
        }
        return result;
    }
}
