package com.martin.fullreval.dto;

import java.util.List;

/** Combinatorial optimizer: instead of one fixed signal window, tries EVERY valid
 * (start month, length) window across the requested universes (sectors and/or countries,
 * evaluated separately — never mixed into one basket) and ranks them by risk-adjusted
 * return, to answer "which window + universe would have worked best over this period".
 *
 * Two modes for how the basket within each (universe, window) cell is chosen:
 *   - "ROTATING" (default): re-picks the signal-window top quartile every year, same as the
 *     main strategy backtest above in the module.
 *   - "FIXED": commits to ONE set of fixedSize tickers for the WHOLE period — searches every
 *     possible fixedSize-ticker subset of the universe for that window and keeps the best —
 *     for "don't change assets on me every year, just tell me the best N to hold". */
public class SeasonalityMonteCarloRequest {
    public List<String> universes = List.of("SECTOR", "COUNTRY"); // "SECTOR" and/or "COUNTRY"
    public String dataSource = "YAHOO_FINANCE";
    public String currencyMode = "USD"; // only applies to the COUNTRY universe
    public int yearFrom;
    public int yearTo;
    public int minAssetsPerYear = 2; // only used in ROTATING mode
    public List<Integer> lengthMonths = List.of(1, 2, 3); // which window lengths to try
    public String mode = "ROTATING"; // "ROTATING" | "FIXED"
    public Integer fixedSize; // required (>=2) when mode == "FIXED"
}
