package com.martin.fullreval.service;

import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * The seasonality module's preloaded, representative asset lists ("activos
 * representativos precargados" in the spec) — one country ETF per major
 * market, one SPDR sector ETF per US sector. Kept as a static in-memory list
 * rather than a database table: it's reference data the user picks from and
 * can extend with a manual ticker, not something they edit — a DB table would
 * just be a migration to maintain for no real benefit here.
 */
@Service
public class AssetUniverseService {

    public record AssetEntry(String ticker, String category, String label, String currency) {}

    private static final List<AssetEntry> COUNTRIES = List.of(
            new AssetEntry("SPY", "COUNTRY", "United States", "USD"),
            new AssetEntry("EWZ", "COUNTRY", "Brazil", "BRL"),
            new AssetEntry("EWJ", "COUNTRY", "Japan", "JPY"),
            new AssetEntry("EWG", "COUNTRY", "Germany", "EUR"),
            new AssetEntry("EWU", "COUNTRY", "United Kingdom", "GBP"),
            new AssetEntry("EWC", "COUNTRY", "Canada", "CAD"),
            new AssetEntry("EWA", "COUNTRY", "Australia", "AUD"),
            new AssetEntry("EWY", "COUNTRY", "South Korea", "KRW"),
            new AssetEntry("MCHI", "COUNTRY", "China", "CNY"),
            new AssetEntry("INDA", "COUNTRY", "India", "INR"),
            new AssetEntry("EWW", "COUNTRY", "Mexico", "MXN"),
            new AssetEntry("EWL", "COUNTRY", "Switzerland", "CHF")
    );

    private static final List<AssetEntry> SECTORS = List.of(
            new AssetEntry("XLK", "SECTOR", "Technology", "USD"),
            new AssetEntry("XLF", "SECTOR", "Financials", "USD"),
            new AssetEntry("XLE", "SECTOR", "Energy", "USD"),
            new AssetEntry("XLV", "SECTOR", "Health Care", "USD"),
            new AssetEntry("XLY", "SECTOR", "Consumer Discretionary", "USD"),
            new AssetEntry("XLP", "SECTOR", "Consumer Staples", "USD"),
            new AssetEntry("XLI", "SECTOR", "Industrials", "USD"),
            new AssetEntry("XLB", "SECTOR", "Materials", "USD"),
            new AssetEntry("XLU", "SECTOR", "Utilities", "USD"),
            new AssetEntry("XLRE", "SECTOR", "Real Estate", "USD"),
            new AssetEntry("XLC", "SECTOR", "Communication Services", "USD")
    );

    public Map<String, Object> listAll() {
        return Map.of("countries", COUNTRIES, "sectors", SECTORS);
    }

    public List<String> sectorTickers() {
        return SECTORS.stream().map(AssetEntry::ticker).toList();
    }

    public List<String> countryTickers() {
        return COUNTRIES.stream().map(AssetEntry::ticker).toList();
    }

    /** USD by default; the preloaded list's currency for a known ticker, else USD. */
    public String currencyOf(String ticker) {
        String t = ticker.trim().toUpperCase();
        return concatAll().stream()
                .filter(a -> a.ticker().equals(t))
                .map(AssetEntry::currency)
                .findFirst()
                .orElse("USD");
    }

    private List<AssetEntry> concatAll() {
        return java.util.stream.Stream.concat(COUNTRIES.stream(), SECTORS.stream()).toList();
    }
}
