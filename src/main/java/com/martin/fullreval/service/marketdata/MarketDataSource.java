package com.martin.fullreval.service.marketdata;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.NavigableMap;

/**
 * One provider of historical daily close prices. The seasonality module talks
 * to whichever implementation the user picks entirely through this interface,
 * so adding a 4th data source later doesn't touch any calling code.
 */
public interface MarketDataSource {

    /** Machine-readable id, e.g. "YAHOO_FINANCE" — matches the frontend's dropdown value. */
    String getId();

    /** Human label for the UI, e.g. "Yahoo Finance". */
    String getDisplayName();

    /** True if this source is actually usable right now (e.g. has an API key configured). */
    boolean isAvailable();

    /**
     * Full available daily close-price history for a ticker, keyed by trading
     * date. Implementations must never throw for "ticker not found" or
     * "network error" — return an empty map instead, so a bad ticker degrades
     * one asset's coverage rather than failing the whole test.
     */
    NavigableMap<LocalDate, BigDecimal> fetchDailyCloses(String ticker);
}
