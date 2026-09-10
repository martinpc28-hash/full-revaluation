package com.martin.fullreval.service.marketdata;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Collections;
import java.util.NavigableMap;

/**
 * Alpha Vantage support — not wired up yet, no API key configured. See
 * EodhdMarketDataSource for why this stub exists instead of just a dropdown
 * option with no backing class. Set ALPHA_VANTAGE_API_KEY to enable once you
 * have one (free tier exists, but is rate-limited to ~25 requests/day, which
 * would need real throttling logic before it's usable for a multi-asset test).
 */
@Component
public class AlphaVantageMarketDataSource implements MarketDataSource {

    private final String apiKey;

    public AlphaVantageMarketDataSource(@Value("${ALPHA_VANTAGE_API_KEY:}") String apiKey) {
        this.apiKey = apiKey;
    }

    @Override
    public String getId() {
        return "ALPHA_VANTAGE";
    }

    @Override
    public String getDisplayName() {
        return "Alpha Vantage";
    }

    @Override
    public boolean isAvailable() {
        return apiKey != null && !apiKey.isBlank();
    }

    @Override
    public NavigableMap<LocalDate, BigDecimal> fetchDailyCloses(String ticker) {
        if (!isAvailable()) {
            return Collections.emptyNavigableMap();
        }
        // TODO: GET https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&outputsize=full&symbol={ticker}&apikey={apiKey}
        throw new UnsupportedOperationException("Alpha Vantage integration not implemented yet");
    }
}
