package com.martin.fullreval.service;

import com.martin.fullreval.dto.SeasonalityMonteCarloRequest;
import com.martin.fullreval.dto.SeasonalitySweepRequest;
import com.martin.fullreval.dto.SeasonalityTestRequest;
import com.martin.fullreval.service.marketdata.MarketDataSource;
import com.martin.fullreval.service.marketdata.MarketDataSourceRegistry;
import org.apache.commons.math3.stat.correlation.SpearmansCorrelation;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.MathContext;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
import java.util.Random;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Seasonality Hypothesis Lab: tests whether an asset's return in a "signal"
 * window (default: Jan-Feb) predicts its relative performance for the rest
 * of the year — the classic "January effect" style hypothesis, generalized to
 * any window so it can be reused for other seasonality questions later.
 *
 * Methodology notes (also surfaced in the UI — read before trusting a number):
 *   - Signal-vs-full-year correlation is shown because it's the hypothesis's
 *     literal original form, but it's partly mechanical: the signal window IS
 *     part of the full year's return. Signal-vs-rest-of-year isolates whether
 *     the effect persists once the signal window itself is over, which is the
 *     comparison that actually tests persistence rather than arithmetic.
 *   - The window sweep exists to tell a genuinely seasonal effect apart from
 *     generic momentum: if Jan-Feb stands out against same-length windows
 *     starting elsewhere in the year, that's seasonality; if all 2-month
 *     windows look similar, it's momentum and the New Year is incidental.
 *   - Per-year Spearman rhos are shown but NOT given their own p-value — a
 *     universe of ~10-12 assets is too small per year for a permutation test
 *     to mean much. p-values are computed only on the pooled (panel) rho.
 *   - A (ticker, year) only counts as "covered" if it has a valid signal,
 *     rest-of-year, AND full-year return; years below minAssetsPerYear are
 *     flagged and excluded from every statistic (but still shown in the
 *     coverage grid) — a rank correlation over 3 assets isn't comparable to
 *     one over 12.
 */
@Service
public class SeasonalityService {

    private static final int PERMUTATION_ITERATIONS = 2000;
    private static final int PERMUTATION_SEED = 42; // reproducible p-values across runs

    private final MarketDataSourceRegistry sourceRegistry;
    private final FxRateService fxRateService;
    private final AssetUniverseService assetUniverseService;

    public SeasonalityService(MarketDataSourceRegistry sourceRegistry, FxRateService fxRateService,
                               AssetUniverseService assetUniverseService) {
        this.sourceRegistry = sourceRegistry;
        this.fxRateService = fxRateService;
        this.assetUniverseService = assetUniverseService;
    }

    /** One return calculation, kept with everything needed to audit it in the UI: the
     * requested window, and the actual trading date/price pair the calc landed on (the
     * ceiling/floor of that window — may differ from the window itself around holidays or
     * data gaps). value = (endPrice - startPrice) / startPrice, null if there's no data. */
    private record ReturnCalc(Double value, LocalDate windowStart, LocalDate windowEnd,
                               LocalDate startDate, BigDecimal startPrice, LocalDate endDate, BigDecimal endPrice) {
        static ReturnCalc empty(LocalDate windowStart, LocalDate windowEnd) {
            return new ReturnCalc(null, windowStart, windowEnd, null, null, null, null);
        }
    }

    private record Point(String ticker, int year, ReturnCalc signal, ReturnCalc rest, ReturnCalc fullYear) {
        boolean coveredForStats() { return signal.value() != null && rest.value() != null && fullYear.value() != null; }
        Double signalValue() { return signal.value(); }
        Double restValue() { return rest.value(); }
        Double fullYearValue() { return fullYear.value(); }
    }

    // ------------------------------------------------------------------
    // Main test
    // ------------------------------------------------------------------

    public Map<String, Object> runTest(SeasonalityTestRequest req) {
        validateWindow(req.signalStartMonth, req.signalLengthMonths);
        MarketDataSource source = sourceRegistry.get(req.dataSource);

        Map<String, NavigableMap<LocalDate, BigDecimal>> closesByTicker = fetchAllCloses(source, req.tickers, req.currencyMode);

        List<Point> allPoints = new ArrayList<>();
        for (String ticker : req.tickers) {
            NavigableMap<LocalDate, BigDecimal> closes = closesByTicker.get(ticker);
            for (int year = req.yearFrom; year <= req.yearTo; year++) {
                allPoints.add(computePoint(ticker, year, closes, req.signalStartMonth, req.signalLengthMonths));
            }
        }

        Map<Integer, Long> assetCountByYear = allPoints.stream()
                .filter(Point::coveredForStats)
                .collect(Collectors.groupingBy(Point::year, Collectors.counting()));

        List<Point> statsPoints = allPoints.stream()
                .filter(Point::coveredForStats)
                .filter(p -> assetCountByYear.getOrDefault(p.year(), 0L) >= req.minAssetsPerYear)
                .collect(Collectors.toList());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("meta", Map.of(
                "source", source.getDisplayName(),
                "currency", "LOCAL".equalsIgnoreCase(req.currencyMode) ? "Moneda local" : "USD",
                "yearFrom", req.yearFrom, "yearTo", req.yearTo,
                "signalStartMonth", req.signalStartMonth, "signalLengthMonths", req.signalLengthMonths,
                "tickers", req.tickers
        ));
        result.put("panel", allPoints.stream().map(this::pointToMap).toList());
        result.put("coverage", coverageReport(allPoints, req.tickers, req.yearFrom, req.yearTo, req.minAssetsPerYear));
        result.put("correlationVsRest", correlationBlock(statsPoints, Point::signalValue, Point::restValue, true));
        result.put("correlationVsFullYear", correlationBlock(statsPoints, Point::signalValue, Point::fullYearValue, true));
        result.put("persistenceVsRest", quartilePersistence(statsPoints, Point::restValue));
        result.put("persistenceVsFullYear", quartilePersistence(statsPoints, Point::fullYearValue));

        // Fixed reference lines for the strategy chart — always USD, same source, same
        // signal/hold-period methodology as the strategy itself, regardless of what the
        // user picked for their own universe/currency (comparing against "the market" and
        // "the world" only makes sense in one consistent currency). Closes kept around (not
        // just the derived yearly returns) because the daily-return volatility calc below
        // needs the actual price series, not just one number per year.
        NavigableMap<LocalDate, BigDecimal> spyCloses = source.fetchDailyCloses("SPY");
        NavigableMap<LocalDate, BigDecimal> urthCloses = source.fetchDailyCloses("URTH");
        Map<Integer, ReturnCalc> sp500Rest = restReturnSeriesFromCloses("SPY", spyCloses, req.yearFrom, req.yearTo, req.signalStartMonth, req.signalLengthMonths);
        Map<Integer, ReturnCalc> msciWorldRest = restReturnSeriesFromCloses("URTH", urthCloses, req.yearFrom, req.yearTo, req.signalStartMonth, req.signalLengthMonths);
        result.put("strategy", strategyBacktest(statsPoints, sp500Rest, msciWorldRest, closesByTicker, spyCloses, urthCloses,
                req.signalStartMonth, req.signalLengthMonths));
        return result;
    }

    /** Rest-of-year return for one fixed benchmark ticker, by year — used only for the
     * strategy chart's SPY/URTH reference lines, always fetched in USD. */
    private Map<Integer, ReturnCalc> restReturnSeriesFromCloses(String ticker, NavigableMap<LocalDate, BigDecimal> closes, int yearFrom, int yearTo,
                                                                  int startMonth, int lengthMonths) {
        Map<Integer, ReturnCalc> series = new LinkedHashMap<>();
        for (int year = yearFrom; year <= yearTo; year++) {
            Point p = computePoint(ticker, year, closes, startMonth, lengthMonths);
            if (p.restValue() != null) series.put(year, p.rest());
        }
        return series;
    }

    // ------------------------------------------------------------------
    // Window sweep
    // ------------------------------------------------------------------

    public Map<String, Object> runSweep(SeasonalitySweepRequest req) {
        MarketDataSource source = sourceRegistry.get(req.dataSource);
        Map<String, NavigableMap<LocalDate, BigDecimal>> closesByTicker = fetchAllCloses(source, req.tickers, req.currencyMode);

        List<Map<String, Object>> cells = new ArrayList<>();
        for (int startMonth = 1; startMonth <= 12; startMonth++) {
            for (int lengthMonths = 1; lengthMonths <= 3; lengthMonths++) {
                if (startMonth + lengthMonths - 1 > 12) {
                    // Cross-year window (e.g. Nov start + 3 months) — excluded, see class javadoc.
                    continue;
                }
                List<Point> points = new ArrayList<>();
                for (String ticker : req.tickers) {
                    NavigableMap<LocalDate, BigDecimal> closes = closesByTicker.get(ticker);
                    for (int year = req.yearFrom; year <= req.yearTo; year++) {
                        points.add(computePoint(ticker, year, closes, startMonth, lengthMonths));
                    }
                }
                Map<Integer, Long> countByYear = points.stream()
                        .filter(Point::coveredForStats)
                        .collect(Collectors.groupingBy(Point::year, Collectors.counting()));
                List<Point> covered = points.stream()
                        .filter(Point::coveredForStats)
                        .filter(p -> countByYear.getOrDefault(p.year(), 0L) >= req.minAssetsPerYear)
                        .toList();

                Map<String, Object> corr = correlationBlock(covered, Point::signalValue, Point::restValue, false); // no p-value: 33 cells x permutation would be slow
                Map<String, Object> cell = new LinkedHashMap<>();
                cell.put("startMonth", startMonth);
                cell.put("lengthMonths", lengthMonths);
                cell.put("rho", corr.get("rho"));
                cell.put("n", corr.get("n"));
                cells.add(cell);
            }
        }

        return Map.of(
                "meta", Map.of("source", source.getDisplayName(), "yearFrom", req.yearFrom, "yearTo", req.yearTo,
                        "tickers", req.tickers, "comparison", "signal vs. resto del año"),
                "cells", cells
        );
    }

    // ------------------------------------------------------------------
    // Combinatorial optimizer ("Monte Carlo" in the UI, though it's an exhaustive grid
    // search, not random sampling — every valid window is actually evaluated)
    // ------------------------------------------------------------------

    /** One (universe, window) combination's top-quartile strategy result, evaluated exactly
     * like strategyBacktest's "Cuartil superior" series: buy the signal-window top quartile
     * at the end of the signal window, hold to year-end, repeat every year, compound. score is
     * CAGR / volatility — a Sharpe-ratio-shaped number (no risk-free rate subtracted) used only
     * to RANK combinations against each other, not as a standalone risk-adjusted metric. */
    private record ComboResult(String universe, int startMonth, int lengthMonths, int yearsUsed,
                                double totalReturn, double cagr, double volatility, double maxDrawdown, double score) {}

    public Map<String, Object> runMonteCarlo(SeasonalityMonteCarloRequest req) {
        validateYearRange(req.yearFrom, req.yearTo);
        MarketDataSource source = sourceRegistry.get(req.dataSource);
        List<Integer> lengths = (req.lengthMonths == null || req.lengthMonths.isEmpty()) ? List.of(1, 2, 3) : req.lengthMonths;
        List<String> universes = (req.universes == null || req.universes.isEmpty()) ? List.of("SECTOR", "COUNTRY") : req.universes;

        List<ComboResult> results = new ArrayList<>();
        for (String universe : universes) {
            boolean isCountry = "COUNTRY".equalsIgnoreCase(universe);
            List<String> tickers = isCountry ? assetUniverseService.countryTickers() : assetUniverseService.sectorTickers();
            String currencyMode = isCountry ? req.currencyMode : "USD";
            Map<String, NavigableMap<LocalDate, BigDecimal>> closesByTicker = fetchAllCloses(source, tickers, currencyMode);

            for (int startMonth = 1; startMonth <= 12; startMonth++) {
                for (int lengthMonths : lengths) {
                    if (startMonth + lengthMonths - 1 > 12) continue; // cross-year window — excluded, see class javadoc

                    List<Point> allPoints = new ArrayList<>();
                    for (String ticker : tickers) {
                        NavigableMap<LocalDate, BigDecimal> closes = closesByTicker.get(ticker);
                        for (int year = req.yearFrom; year <= req.yearTo; year++) {
                            allPoints.add(computePoint(ticker, year, closes, startMonth, lengthMonths));
                        }
                    }
                    Map<Integer, Long> assetCountByYear = allPoints.stream()
                            .filter(Point::coveredForStats)
                            .collect(Collectors.groupingBy(Point::year, Collectors.counting()));
                    List<Point> statsPoints = allPoints.stream()
                            .filter(Point::coveredForStats)
                            .filter(p -> assetCountByYear.getOrDefault(p.year(), 0L) >= req.minAssetsPerYear)
                            .toList();

                    ComboResult combo = evaluateCombo(universe, statsPoints, closesByTicker, startMonth, lengthMonths);
                    if (combo != null) results.add(combo);
                }
            }
        }

        results.sort(Comparator.comparingDouble(ComboResult::score).reversed());
        List<Map<String, Object>> combosJson = results.stream().map(this::comboToMap).toList();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("meta", Map.of("source", source.getDisplayName(), "yearFrom", req.yearFrom, "yearTo", req.yearTo,
                "universes", universes, "lengthsTested", lengths, "minAssetsPerYear", req.minAssetsPerYear,
                "combosEvaluated", combosJson.size()));
        result.put("combos", combosJson);
        result.put("best", combosJson.isEmpty() ? null : combosJson.get(0));
        return result;
    }

    /** Same top-quartile-by-signal, hold-to-year-end logic as strategyBacktest, but reduced to
     * just the summary numbers a combinatorial search needs (no per-year rows, no benchmark
     * comparison) — returns null if there isn't enough covered data to say anything. */
    private ComboResult evaluateCombo(String universeLabel, List<Point> statsPoints,
                                       Map<String, NavigableMap<LocalDate, BigDecimal>> closesByTicker,
                                       int startMonth, int lengthMonths) {
        Map<Integer, List<Point>> byYear = statsPoints.stream()
                .filter(p -> p.restValue() != null)
                .collect(Collectors.groupingBy(Point::year));

        List<Integer> years = new ArrayList<>(byYear.keySet());
        years.sort(Comparator.naturalOrder());

        Map<Integer, List<String>> topQuartileByYear = new LinkedHashMap<>();
        List<Integer> usableYears = new ArrayList<>();
        double cumStrategy = 1.0;
        for (int year : years) {
            List<Point> yearPoints = byYear.get(year);
            if (yearPoints.size() < 2) continue; // need at least 2 to have a "top" and a "rest"
            int quartileSize = (int) Math.ceil(yearPoints.size() / 4.0);
            List<Point> topQuartile = yearPoints.stream()
                    .sorted(Comparator.comparingDouble(Point::signalValue).reversed())
                    .limit(quartileSize)
                    .toList();
            double strategyReturn = topQuartile.stream().mapToDouble(Point::restValue).average().orElse(0);
            cumStrategy *= 1.0 + strategyReturn;
            topQuartileByYear.put(year, topQuartile.stream().map(Point::ticker).toList());
            usableYears.add(year);
        }
        if (usableYears.size() < 2) return null; // one data point can't show a meaningful risk/return trade-off

        DailySeries daily = buildDailySeries(usableYears, topQuartileByYear::get, closesByTicker, startMonth, lengthMonths);
        double totalReturn = cumStrategy - 1.0;
        double cagr = Math.pow(cumStrategy, 1.0 / usableYears.size()) - 1.0;
        double score = daily.volatility() > 0 ? cagr / daily.volatility() : 0.0;
        return new ComboResult(universeLabel, startMonth, lengthMonths, usableYears.size(), totalReturn, cagr, daily.volatility(), daily.maxDrawdown(), score);
    }

    private Map<String, Object> comboToMap(ComboResult c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("universe", c.universe());
        m.put("startMonth", c.startMonth());
        m.put("lengthMonths", c.lengthMonths());
        m.put("yearsUsed", c.yearsUsed());
        m.put("totalReturn", c.totalReturn());
        m.put("cagr", c.cagr());
        m.put("volatility", c.volatility());
        m.put("maxDrawdown", c.maxDrawdown());
        m.put("score", c.score());
        return m;
    }

    private void validateYearRange(int yearFrom, int yearTo) {
        if (yearFrom > yearTo) throw new IllegalArgumentException("yearFrom no puede ser mayor que yearTo");
    }

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------

    private void validateWindow(int startMonth, int lengthMonths) {
        if (startMonth < 1 || startMonth > 12) throw new IllegalArgumentException("signalStartMonth debe estar entre 1 y 12");
        if (lengthMonths < 1 || lengthMonths > 11) throw new IllegalArgumentException("signalLengthMonths inválido");
        if (startMonth + lengthMonths - 1 > 12) {
            throw new IllegalArgumentException("La ventana de señal no puede cruzar el fin de año "
                    + "(mes de inicio + duración - 1 debe ser <= 12). Elegí una ventana más corta o que empiece antes.");
        }
    }

    private Map<String, NavigableMap<LocalDate, BigDecimal>> fetchAllCloses(MarketDataSource source, List<String> tickers, String currencyMode) {
        Map<String, NavigableMap<LocalDate, BigDecimal>> closes = new HashMap<>();
        for (String rawTicker : tickers) {
            String ticker = rawTicker.trim().toUpperCase();
            NavigableMap<LocalDate, BigDecimal> usdCloses = source.fetchDailyCloses(ticker);
            if ("LOCAL".equalsIgnoreCase(currencyMode)) {
                String currency = assetUniverseService.currencyOf(ticker);
                usdCloses = fxRateService.convertToLocal(usdCloses, currency);
            }
            closes.put(ticker, usdCloses);
        }
        return closes;
    }

    private Point computePoint(String ticker, int year, NavigableMap<LocalDate, BigDecimal> closes,
                                int startMonth, int lengthMonths) {
        LocalDate windowStart = LocalDate.of(year, startMonth, 1);
        LocalDate windowEnd = windowStart.plusMonths(lengthMonths).minusDays(1);
        LocalDate yearStart = LocalDate.of(year, 1, 1);
        LocalDate yearEnd = LocalDate.of(year, 12, 31);

        ReturnCalc signal = computeReturnCalc(closes, windowStart, windowEnd);
        ReturnCalc rest = windowEnd.isBefore(yearEnd)
                ? computeReturnCalc(closes, windowEnd.plusDays(1), yearEnd)
                : ReturnCalc.empty(windowEnd.plusDays(1), yearEnd);
        ReturnCalc fullYear = computeReturnCalc(closes, yearStart, yearEnd);
        return new Point(ticker, year, signal, rest, fullYear);
    }

    /** Core return calc, kept alongside the exact dates/prices used — this is what powers the
     * "audit this number" panel in the UI: value = (endPrice - startPrice) / startPrice, where
     * startPrice/endPrice are the closes on the first trading day on/after `from` and the last
     * trading day on/before `to` respectively (may not exactly equal from/to around holidays or
     * missing data — that's why both the requested window and the actual dates used are kept). */
    private ReturnCalc computeReturnCalc(NavigableMap<LocalDate, BigDecimal> closes, LocalDate from, LocalDate to) {
        if (closes == null || closes.isEmpty()) return ReturnCalc.empty(from, to);
        Map.Entry<LocalDate, BigDecimal> startEntry = closes.ceilingEntry(from);
        Map.Entry<LocalDate, BigDecimal> endEntry = closes.floorEntry(to);
        if (startEntry == null || endEntry == null || startEntry.getKey().isAfter(endEntry.getKey())) {
            return ReturnCalc.empty(from, to);
        }
        BigDecimal startPrice = startEntry.getValue();
        if (startPrice.signum() == 0) return ReturnCalc.empty(from, to);
        BigDecimal endPrice = endEntry.getValue();
        double value = endPrice.subtract(startPrice).divide(startPrice, MathContext.DECIMAL64).doubleValue();
        return new ReturnCalc(value, from, to, startEntry.getKey(), startPrice, endEntry.getKey(), endPrice);
    }

    /** JSON-friendly audit trail for one return calculation, shown in the UI's "auditar este
     * número" panel: which ticker, which window, and the exact start/end date+price used. */
    private Map<String, Object> auditMap(String ticker, ReturnCalc rc) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ticker", ticker);
        m.put("value", rc.value());
        m.put("windowStart", rc.windowStart() == null ? null : rc.windowStart().toString());
        m.put("windowEnd", rc.windowEnd() == null ? null : rc.windowEnd().toString());
        m.put("startDate", rc.startDate() == null ? null : rc.startDate().toString());
        m.put("startPrice", rc.startPrice());
        m.put("endDate", rc.endDate() == null ? null : rc.endDate().toString());
        m.put("endPrice", rc.endPrice());
        return m;
    }

    private Map<String, Object> pointToMap(Point p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ticker", p.ticker());
        m.put("year", p.year());
        m.put("signalReturn", p.signal().value());
        m.put("restReturn", p.rest().value());
        m.put("fullYearReturn", p.fullYear().value());
        m.put("covered", p.coveredForStats());
        m.put("signalAudit", auditMap(p.ticker(), p.signal()));
        m.put("restAudit", auditMap(p.ticker(), p.rest()));
        m.put("fullYearAudit", auditMap(p.ticker(), p.fullYear()));
        return m;
    }

    private Map<String, Object> coverageReport(List<Point> allPoints, List<String> tickers, int yearFrom, int yearTo, int minAssetsPerYear) {
        Map<Integer, Long> assetCountByYear = allPoints.stream()
                .filter(Point::coveredForStats)
                .collect(Collectors.groupingBy(Point::year, Collectors.counting()));

        List<Map<String, Object>> byYear = new ArrayList<>();
        for (int year = yearFrom; year <= yearTo; year++) {
            long count = assetCountByYear.getOrDefault(year, 0L);
            byYear.add(Map.of("year", year, "assetCount", count, "sufficient", count >= minAssetsPerYear));
        }

        List<Map<String, Object>> byTickerYear = allPoints.stream()
                .map(p -> Map.<String, Object>of("ticker", p.ticker(), "year", p.year(), "covered", p.coveredForStats()))
                .toList();

        return Map.of("byYear", byYear, "byTickerYear", byTickerYear, "minAssetsPerYear", minAssetsPerYear);
    }

    /** Pooled (panel) Spearman rho between two point-extractors, with an optional permutation p-value. */
    private Map<String, Object> correlationBlock(List<Point> points, java.util.function.Function<Point, Double> xFn,
                                                   java.util.function.Function<Point, Double> yFn, boolean withPValue) {
        List<Point> pairs = points.stream().filter(p -> xFn.apply(p) != null && yFn.apply(p) != null).toList();
        double[] x = pairs.stream().mapToDouble(xFn::apply).toArray();
        double[] y = pairs.stream().mapToDouble(yFn::apply).toArray();

        Map<String, Object> block = new LinkedHashMap<>();
        block.put("n", x.length);
        if (x.length < 4) {
            block.put("rho", null);
            block.put("pValue", null);
            block.put("perYear", List.of());
            return block;
        }

        SpearmansCorrelation spearman = new SpearmansCorrelation();
        double rho = spearman.correlation(x, y);
        block.put("rho", rho);

        if (withPValue) {
            block.put("pValue", permutationPValue(x, y, rho));
        }

        // Per-year rhos (no p-value — see class javadoc).
        Map<Integer, List<Point>> byYear = pairs.stream().collect(Collectors.groupingBy(Point::year));
        List<Map<String, Object>> perYear = byYear.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> {
                    List<Point> yearPairs = e.getValue();
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("year", e.getKey());
                    row.put("n", yearPairs.size());
                    if (yearPairs.size() >= 4) {
                        double[] yx = yearPairs.stream().mapToDouble(xFn::apply).toArray();
                        double[] yy = yearPairs.stream().mapToDouble(yFn::apply).toArray();
                        row.put("rho", new SpearmansCorrelation().correlation(yx, yy));
                    } else {
                        row.put("rho", null);
                    }
                    return row;
                })
                .toList();
        block.put("perYear", perYear);
        return block;
    }

    /** Permutation test: shuffle y repeatedly, p = fraction of shuffles at least as extreme as the observed rho. */
    private double permutationPValue(double[] x, double[] y, double observedRho) {
        SpearmansCorrelation spearman = new SpearmansCorrelation();
        Random random = new Random(PERMUTATION_SEED);
        double[] yCopy = y.clone();
        int extreme = 0;
        for (int i = 0; i < PERMUTATION_ITERATIONS; i++) {
            shuffle(yCopy, random);
            double permRho = spearman.correlation(x, yCopy);
            if (Math.abs(permRho) >= Math.abs(observedRho)) extreme++;
        }
        return (extreme + 1.0) / (PERMUTATION_ITERATIONS + 1.0);
    }

    private void shuffle(double[] arr, Random random) {
        for (int i = arr.length - 1; i > 0; i--) {
            int j = random.nextInt(i + 1);
            double tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
    }

    /** What fraction of the signal-window top quartile is ALSO in the comparison-window top quartile, per year and averaged. */
    private Map<String, Object> quartilePersistence(List<Point> points, java.util.function.Function<Point, Double> comparisonFn) {
        Map<Integer, List<Point>> byYear = points.stream()
                .filter(p -> comparisonFn.apply(p) != null)
                .collect(Collectors.groupingBy(Point::year));

        List<Map<String, Object>> perYear = new ArrayList<>();
        List<Double> persistenceValues = new ArrayList<>();

        for (Map.Entry<Integer, List<Point>> e : byYear.entrySet()) {
            List<Point> yearPoints = e.getValue();
            // Need at least 2 to split a "top" from a "bottom" at all — with exactly 2 assets
            // this degenerates to "which of the two led", which is still a valid comparison,
            // just not a literal quartile (quartileSize below is 1 of 2, i.e. the top half).
            if (yearPoints.size() < 2) continue;
            int quartileSize = (int) Math.ceil(yearPoints.size() / 4.0);

            Set<String> topBySignal = yearPoints.stream()
                    .sorted(Comparator.comparingDouble(Point::signalValue).reversed())
                    .limit(quartileSize)
                    .map(Point::ticker)
                    .collect(Collectors.toSet());
            Set<String> topByComparison = yearPoints.stream()
                    .sorted(Comparator.comparingDouble((Point p) -> comparisonFn.apply(p)).reversed())
                    .limit(quartileSize)
                    .map(Point::ticker)
                    .collect(Collectors.toSet());

            long overlap = topBySignal.stream().filter(topByComparison::contains).count();
            double persistence = (double) overlap / topBySignal.size();
            persistenceValues.add(persistence);

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("year", e.getKey());
            row.put("persistence", persistence);
            row.put("quartileSize", quartileSize);
            perYear.add(row);
        }
        perYear.sort(Comparator.comparing(m -> (Integer) m.get("year")));

        double average = persistenceValues.stream().mapToDouble(Double::doubleValue).average().orElse(Double.NaN);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("average", Double.isNaN(average) ? null : average);
        result.put("expectedRandom", 0.25);
        result.put("yearsUsed", persistenceValues.size());
        result.put("perYear", perYear);
        return result;
    }

    /** Equal-weight top-quartile-by-signal portfolio, held for the REST of the year (buying at the end of the
     * signal window, since that's the earliest point the signal is actually known — using the full-year return
     * here would be look-ahead bias), vs. the equal-weighted full universe over the same holding period. */
    private Map<String, Object> strategyBacktest(List<Point> points, Map<Integer, ReturnCalc> sp500Rest, Map<Integer, ReturnCalc> msciWorldRest,
                                                   Map<String, NavigableMap<LocalDate, BigDecimal>> closesByTicker,
                                                   NavigableMap<LocalDate, BigDecimal> spyCloses, NavigableMap<LocalDate, BigDecimal> urthCloses,
                                                   int startMonth, int lengthMonths) {
        Map<Integer, List<Point>> byYear = points.stream()
                .filter(p -> p.restValue() != null)
                .collect(Collectors.groupingBy(Point::year));

        List<Map<String, Object>> perYear = new ArrayList<>();
        for (Map.Entry<Integer, List<Point>> e : byYear.entrySet()) {
            List<Point> yearPoints = e.getValue();
            if (yearPoints.size() < 2) continue; // need at least 2 to have a "top" and a "rest"
            int quartileSize = (int) Math.ceil(yearPoints.size() / 4.0);

            List<Point> topQuartile = yearPoints.stream()
                    .sorted(Comparator.comparingDouble(Point::signalValue).reversed())
                    .limit(quartileSize)
                    .toList();

            double strategyReturn = topQuartile.stream().mapToDouble(Point::restValue).average().orElse(0);
            double benchmarkReturn = yearPoints.stream().mapToDouble(Point::restValue).average().orElse(0);

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("year", e.getKey());
            row.put("strategyReturn", strategyReturn);
            row.put("benchmarkReturn", benchmarkReturn);
            row.put("diff", strategyReturn - benchmarkReturn);
            // Audit trail: exactly which tickers make up this average, and each one's own
            // start/end date+price — this is what the UI's "auditar" click shows.
            row.put("strategyReturnAudit", topQuartile.stream().map(p -> auditMap(p.ticker(), p.rest())).toList());
            row.put("benchmarkReturnAudit", yearPoints.stream().map(p -> auditMap(p.ticker(), p.rest())).toList());
            perYear.add(row);
        }
        perYear.sort(Comparator.comparing(m -> (Integer) m.get("year")));
        List<Integer> years = perYear.stream().map(m -> (Integer) m.get("year")).toList();

        // A benchmark that doesn't cover the WHOLE requested range (e.g. URTH only started
        // trading in 2012) is dropped entirely rather than shown as a flat 0% line for the
        // years before it existed — that would misleadingly read as "no return", not "no data".
        boolean includeSp500 = years.stream().allMatch(sp500Rest::containsKey);
        boolean includeMsciWorld = years.stream().allMatch(msciWorldRest::containsKey);

        if (includeSp500) {
            for (Map<String, Object> row : perYear) {
                ReturnCalc rc = sp500Rest.get((Integer) row.get("year"));
                row.put("sp500Return", rc.value());
                row.put("diffVsSp500", (double) row.get("strategyReturn") - rc.value());
                row.put("sp500ReturnAudit", List.of(auditMap("SPY", rc)));
            }
        }

        List<Map<String, Object>> cumulative = new ArrayList<>();
        double cumStrategy = 1.0, cumBenchmark = 1.0, cumSp500 = 1.0, cumMsciWorld = 1.0;
        for (Map<String, Object> row : perYear) {
            int year = (Integer) row.get("year");
            cumStrategy *= 1.0 + (double) row.get("strategyReturn");
            cumBenchmark *= 1.0 + (double) row.get("benchmarkReturn");
            if (includeSp500) cumSp500 *= 1.0 + sp500Rest.get(year).value();
            if (includeMsciWorld) cumMsciWorld *= 1.0 + msciWorldRest.get(year).value();

            Map<String, Object> point = new LinkedHashMap<>();
            point.put("year", year);
            point.put("cumulativeStrategy", cumStrategy - 1.0);
            point.put("cumulativeBenchmark", cumBenchmark - 1.0);
            if (includeSp500) point.put("cumulativeSp500", cumSp500 - 1.0);
            if (includeMsciWorld) point.put("cumulativeMsciWorld", cumMsciWorld - 1.0);
            cumulative.add(point);
        }

        // Which tickers make up each series, per year — needed to build the real daily wealth
        // curve below (both for volatility AND for max drawdown, so a mid-year dip that fully
        // recovers by December — invisible if you only look at year-end snapshots — actually
        // shows up).
        Map<Integer, List<String>> topQuartileByYear = new LinkedHashMap<>();
        Map<Integer, List<String>> allTickersByYear = new LinkedHashMap<>();
        for (int year : years) {
            List<Point> yearPoints = byYear.get(year);
            if (yearPoints == null || yearPoints.size() < 2) continue;
            int quartileSize = (int) Math.ceil(yearPoints.size() / 4.0);
            topQuartileByYear.put(year, yearPoints.stream()
                    .sorted(Comparator.comparingDouble(Point::signalValue).reversed())
                    .limit(quartileSize)
                    .map(Point::ticker)
                    .toList());
            allTickersByYear.put(year, yearPoints.stream().map(Point::ticker).toList());
        }

        DailySeries strategyDaily = buildDailySeries(years, topQuartileByYear::get, closesByTicker, startMonth, lengthMonths);
        DailySeries benchmarkDaily = buildDailySeries(years, allTickersByYear::get, closesByTicker, startMonth, lengthMonths);
        DailySeries sp500Daily = includeSp500
                ? buildDailySeries(years, y -> List.of("SPY"), Map.of("SPY", spyCloses), startMonth, lengthMonths) : null;
        DailySeries msciDaily = includeMsciWorld
                ? buildDailySeries(years, y -> List.of("URTH"), Map.of("URTH", urthCloses), startMonth, lengthMonths) : null;

        // Per-year max drawdown (running, as of that year-end, but built from real daily
        // closes within each year — not just its closing snapshot) — attached to the SAME
        // perYear rows the two "vs. Universo" / "vs. S&P 500" tables already render.
        for (int i = 0; i < perYear.size(); i++) {
            int year = years.get(i);
            perYear.get(i).put("strategyDrawdown", strategyDaily.maxDrawdownByYear().getOrDefault(year, 0.0));
            perYear.get(i).put("benchmarkDrawdown", benchmarkDaily.maxDrawdownByYear().getOrDefault(year, 0.0));
            if (includeSp500) perYear.get(i).put("sp500Drawdown", sp500Daily.maxDrawdownByYear().getOrDefault(year, 0.0));
            if (includeMsciWorld) perYear.get(i).put("msciWorldDrawdown", msciDaily.maxDrawdownByYear().getOrDefault(year, 0.0));
        }

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("strategy", Map.of("volatility", strategyDaily.volatility(), "maxDrawdown", strategyDaily.maxDrawdown()));
        stats.put("benchmark", Map.of("volatility", benchmarkDaily.volatility(), "maxDrawdown", benchmarkDaily.maxDrawdown()));
        if (includeSp500) {
            stats.put("sp500", Map.of("volatility", sp500Daily.volatility(), "maxDrawdown", sp500Daily.maxDrawdown()));
        }
        if (includeMsciWorld) {
            stats.put("msciWorld", Map.of("volatility", msciDaily.volatility(), "maxDrawdown", msciDaily.maxDrawdown()));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("perYear", perYear);
        result.put("cumulative", cumulative);
        result.put("sp500Available", includeSp500);
        result.put("msciWorldAvailable", includeMsciWorld);
        result.put("stats", stats);
        return result;
    }

    /** volatility: annualized stdev of the chronological daily-return series. maxDrawdown: worst
     * peak-to-trough over the SAME continuous daily wealth curve (built once, used for both —
     * see buildDailySeries). maxDrawdownByYear: that curve's running drawdown as of each
     * year-end, i.e. what the per-year table columns show. */
    private record DailySeries(double volatility, double maxDrawdown, Map<Integer, Double> maxDrawdownByYear) {}

    /**
     * Builds ONE continuous, chronologically-ordered daily wealth curve for a series (top
     * quartile for "strategy", the whole covered universe for "benchmark", SPY/URTH for the
     * fixed lines) across every year, compounding real daily returns during each year's
     * holding period (day after the signal window ends, through Dec 31). Between one year's
     * holding period and the next year's, wealth is held FLAT — the strategy isn't invested
     * during the signal window itself (that's the whole point of "buy at the end of it, not
     * before"), so there's nothing for it to gain or lose there. A day's portfolio return is
     * the simple average of its constituents' own daily returns (equal weight, rebalanced
     * daily). Computing volatility and drawdown off this ONE ordered series (instead of a
     * year-end-only snapshot) is what lets a mid-year dip that fully recovers by December
     * actually show up as a drawdown.
     */
    private DailySeries buildDailySeries(List<Integer> years, java.util.function.Function<Integer, List<String>> basketForYear,
                                          Map<String, NavigableMap<LocalDate, BigDecimal>> closesByTicker,
                                          int startMonth, int lengthMonths) {
        List<Double> allDailyReturns = new ArrayList<>();
        double wealth = 1.0;
        double peak = 1.0;
        double maxDrawdown = 0.0;
        Map<Integer, Double> maxDrawdownByYear = new LinkedHashMap<>();

        for (int year : years) {
            List<String> basket = basketForYear.apply(year);
            LocalDate windowStart = LocalDate.of(year, startMonth, 1);
            LocalDate windowEnd = windowStart.plusMonths(lengthMonths).minusDays(1);
            LocalDate holdStart = windowEnd.plusDays(1);
            LocalDate holdEnd = LocalDate.of(year, 12, 31);

            if (basket != null && !basket.isEmpty() && holdStart.isBefore(holdEnd)) {
                List<Double> dailyReturns = portfolioDailyReturns(basket, closesByTicker, holdStart, holdEnd);
                allDailyReturns.addAll(dailyReturns);
                for (double r : dailyReturns) {
                    wealth *= 1.0 + r;
                    peak = Math.max(peak, wealth);
                    maxDrawdown = Math.min(maxDrawdown, (wealth - peak) / peak);
                }
            }
            maxDrawdownByYear.put(year, maxDrawdown); // snapshot as of this year-end either way
        }

        return new DailySeries(annualizedVolFromDaily(allDailyReturns), maxDrawdown, maxDrawdownByYear);
    }

    /** Equal-weighted daily portfolio returns over [from, to], using the first ticker's trading
     * calendar as the reference dates (all this app's tickers are US-listed ETFs sharing
     * essentially the same NYSE calendar — a reasonable simplification, not perfect). */
    private List<Double> portfolioDailyReturns(List<String> tickers, Map<String, NavigableMap<LocalDate, BigDecimal>> closesByTicker,
                                                LocalDate from, LocalDate to) {
        if (tickers.isEmpty()) return List.of();
        NavigableMap<LocalDate, BigDecimal> reference = closesByTicker.get(tickers.get(0));
        if (reference == null || reference.isEmpty()) return List.of();
        List<LocalDate> dates = new ArrayList<>(reference.subMap(from, true, to, true).keySet());

        List<Double> portfolioReturns = new ArrayList<>();
        for (int i = 1; i < dates.size(); i++) {
            LocalDate prev = dates.get(i - 1);
            LocalDate curr = dates.get(i);
            double sum = 0;
            int count = 0;
            for (String ticker : tickers) {
                NavigableMap<LocalDate, BigDecimal> closes = closesByTicker.get(ticker);
                if (closes == null) continue;
                BigDecimal p0 = closes.get(prev);
                BigDecimal p1 = closes.get(curr);
                if (p0 == null || p1 == null || p0.signum() == 0) continue;
                sum += p1.subtract(p0).divide(p0, MathContext.DECIMAL64).doubleValue();
                count++;
            }
            if (count > 0) portfolioReturns.add(sum / count);
        }
        return portfolioReturns;
    }

    private static final double TRADING_DAYS_PER_YEAR = 252.0;

    private double annualizedVolFromDaily(List<Double> dailyReturns) {
        if (dailyReturns.size() < 2) return 0.0;
        double mean = dailyReturns.stream().mapToDouble(d -> d).average().orElse(0);
        double variance = dailyReturns.stream().mapToDouble(r -> Math.pow(r - mean, 2)).sum() / (dailyReturns.size() - 1);
        return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    }
}
