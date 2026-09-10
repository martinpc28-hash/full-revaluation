package com.martin.fullreval.service.marketdata;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Collections;
import java.util.NavigableMap;

/**
 * EODHD (eodhistoricaldata.com) support — not wired up yet, no API key
 * configured. Kept as a real class (not deleted) so the source picker can
 * list it as "coming soon" and so implementing it later is a matter of
 * filling in fetchDailyCloses, not restructuring anything upstream.
 * Set EODHD_API_KEY to enable once you have one.
 */
@Component
public class EodhdMarketDataSource implements MarketDataSource {

    private final String apiKey;

    public EodhdMarketDataSource(@Value("${EODHD_API_KEY:}") String apiKey) {
        this.apiKey = apiKey;
    }

    @Override
    public String getId() {
        return "EODHD";
    }

    @Override
    public String getDisplayName() {
        return "EODHD";
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
        // TODO: GET https://eodhistoricaldata.com/api/eod/{ticker}?api_token={apiKey}&period=d&fmt=json
        throw new UnsupportedOperationException("EODHD integration not implemented yet");
    }
}
