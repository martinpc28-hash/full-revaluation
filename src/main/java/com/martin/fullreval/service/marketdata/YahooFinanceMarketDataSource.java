package com.martin.fullreval.service.marketdata;

import com.martin.fullreval.service.YahooFinanceService;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.NavigableMap;

@Component
public class YahooFinanceMarketDataSource implements MarketDataSource {

    private final YahooFinanceService yahooFinanceService;

    public YahooFinanceMarketDataSource(YahooFinanceService yahooFinanceService) {
        this.yahooFinanceService = yahooFinanceService;
    }

    @Override
    public String getId() {
        return "YAHOO_FINANCE";
    }

    @Override
    public String getDisplayName() {
        return "Yahoo Finance";
    }

    @Override
    public boolean isAvailable() {
        return true; // no API key needed
    }

    @Override
    public NavigableMap<LocalDate, BigDecimal> fetchDailyCloses(String ticker) {
        return yahooFinanceService.fetchDailyCloses(ticker);
    }
}
