package com.martin.fullreval.service;

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

    private record Point(String ticker, int year, Double signal, Double rest, Double fullYear) {
        boolean coveredForStats() { return signal != null && rest != null && fullYear != null; }
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
        result.put("correlationVsRest", correlationBlock(statsPoints, Point::signal, Point::rest, true));
        result.put("correlationVsFullYear", correlationBlock(statsPoints, Point::signal, Point::fullYear, true));
        result.put("persistenceVsRest", quartilePersistence(statsPoints, Point::rest));
        result.put("persistenceVsFullYear", quartilePersistence(statsPoints, Point::fullYear));
        result.put("strategy", strategyBacktest(statsPoints));
        return result;
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

                Map<String, Object> corr = correlationBlock(covered, Point::signal, Point::rest, false); // no p-value: 33 cells x permutation would be slow
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
        if (closes == null || closes.isEmpty()) {
            return new Point(ticker, year, null, null, null);
        }
        LocalDate windowStart = LocalDate.of(year, startMonth, 1);
        LocalDate windowEnd = windowStart.plusMonths(lengthMonths).minusDays(1);
        LocalDate yearStart = LocalDate.of(year, 1, 1);
        LocalDate yearEnd = LocalDate.of(year, 12, 31);

        Double signal = toDouble(cumulativeReturn(closes, windowStart, windowEnd));
        Double rest = windowEnd.isBefore(yearEnd) ? toDouble(cumulativeReturn(closes, windowEnd.plusDays(1), yearEnd)) : null;
        Double fullYear = toDouble(cumulativeReturn(closes, yearStart, yearEnd));
        return new Point(ticker, year, signal, rest, fullYear);
    }

    private BigDecimal cumulativeReturn(NavigableMap<LocalDate, BigDecimal> closes, LocalDate from, LocalDate to) {
        Map.Entry<LocalDate, BigDecimal> startEntry = closes.ceilingEntry(from);
        Map.Entry<LocalDate, BigDecimal> endEntry = closes.floorEntry(to);
        if (startEntry == null || endEntry == null) return null;
        if (startEntry.getKey().isAfter(endEntry.getKey())) return null;
        BigDecimal startPrice = startEntry.getValue();
        if (startPrice.signum() == 0) return null;
        return endEntry.getValue().subtract(startPrice).divide(startPrice, MathContext.DECIMAL64);
    }

    private Double toDouble(BigDecimal value) {
        return value == null ? null : value.doubleValue();
    }

    private Map<String, Object> pointToMap(Point p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ticker", p.ticker());
        m.put("year", p.year());
        m.put("signalReturn", p.signal());
        m.put("restReturn", p.rest());
        m.put("fullYearReturn", p.fullYear());
        m.put("covered", p.coveredForStats());
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
            if (yearPoints.size() < 4) continue; // need at least 4 for a quartile to mean anything
            int quartileSize = (int) Math.ceil(yearPoints.size() / 4.0);

            Set<String> topBySignal = yearPoints.stream()
                    .sorted(Comparator.comparingDouble(Point::signal).reversed())
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
    private Map<String, Object> strategyBacktest(List<Point> points) {
        Map<Integer, List<Point>> byYear = points.stream()
                .filter(p -> p.rest() != null)
                .collect(Collectors.groupingBy(Point::year));

        List<Map<String, Object>> perYear = new ArrayList<>();
        for (Map.Entry<Integer, List<Point>> e : byYear.entrySet()) {
            List<Point> yearPoints = e.getValue();
            if (yearPoints.size() < 4) continue;
            int quartileSize = (int) Math.ceil(yearPoints.size() / 4.0);

            List<Point> topQuartile = yearPoints.stream()
                    .sorted(Comparator.comparingDouble(Point::signal).reversed())
                    .limit(quartileSize)
                    .toList();

            double strategyReturn = topQuartile.stream().mapToDouble(Point::rest).average().orElse(0);
            double benchmarkReturn = yearPoints.stream().mapToDouble(Point::rest).average().orElse(0);

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("year", e.getKey());
            row.put("strategyReturn", strategyReturn);
            row.put("benchmarkReturn", benchmarkReturn);
            row.put("diff", strategyReturn - benchmarkReturn);
            perYear.add(row);
        }
        perYear.sort(Comparator.comparing(m -> (Integer) m.get("year")));

        List<Map<String, Object>> cumulative = new ArrayList<>();
        double cumStrategy = 1.0, cumBenchmark = 1.0;
        for (Map<String, Object> row : perYear) {
            cumStrategy *= 1.0 + (double) row.get("strategyReturn");
            cumBenchmark *= 1.0 + (double) row.get("benchmarkReturn");
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("year", row.get("year"));
            point.put("cumulativeStrategy", cumStrategy - 1.0);
            point.put("cumulativeBenchmark", cumBenchmark - 1.0);
            cumulative.add(point);
        }

        return Map.of("perYear", perYear, "cumulative", cumulative);
    }
}
