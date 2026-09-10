package com.martin.fullreval.dto;

import java.util.List;

public class SeasonalityTestRequest {
    public List<String> tickers;
    public String dataSource = "YAHOO_FINANCE";
    public String currencyMode = "USD"; // "USD" or "LOCAL"
    public int yearFrom;
    public int yearTo;
    public int signalStartMonth = 1;    // 1 = January
    public int signalLengthMonths = 2;  // default: Jan-Feb
    public int minAssetsPerYear = 4;    // years with fewer covered assets are flagged, excluded from stats
}
