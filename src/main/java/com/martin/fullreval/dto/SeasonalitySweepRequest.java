package com.martin.fullreval.dto;

import java.util.List;

public class SeasonalitySweepRequest {
    public List<String> tickers;
    public String dataSource = "YAHOO_FINANCE";
    public String currencyMode = "USD";
    public int yearFrom;
    public int yearTo;
    public int minAssetsPerYear = 4;
}
