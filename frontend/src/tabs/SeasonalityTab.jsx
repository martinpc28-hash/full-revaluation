import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { ui, colors } from "../theme.js";
import HeatmapGrid, { divergingColor } from "../HeatmapGrid.jsx";
import ScatterChart from "../ScatterChart.jsx";
import LineChart from "../LineChart.jsx";
import AuditPanel, { Drawer } from "../AuditPanel.jsx";

// Shared style for any "Retorno" number the user can click to audit (see AuditPanel) —
// a dotted underline + pointer cursor signals it's interactive without being noisy.
const auditableCell = {
  cursor: "pointer",
  textDecoration: "underline",
  textDecorationStyle: "dotted",
  textDecorationColor: colors.border,
  textUnderlineOffset: 3,
};

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const UNIVERSE_LABELS = { SECTOR: "Sectores", COUNTRY: "Países" };

// e.g. startMonth=1 (Ene), lengthMonths=1 → señal es SOLO enero, y la cartera se compra
// entrando febrero (el mes siguiente al último de la ventana) y se mantiene hasta el 31/12.
// Se muestra explícito porque "Ene (1m)" solo, sin la flecha, generaba confusión sobre
// cuándo arranca realmente la cartera.
function windowLabel(startMonth, lengthMonths) {
  const holdStartMonth = startMonth + lengthMonths; // siempre <=12 para combos que sí aparecen
  return `${MONTH_NAMES[startMonth - 1]} (${lengthMonths}m) → cartera desde ${MONTH_NAMES[holdStartMonth - 1]}`;
}
const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_YEAR_FROM = Math.max(2001, CURRENT_YEAR - 20);
const DEFAULT_YEAR_TO = CURRENT_YEAR - 1;

function pct(v, digits = 1) {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
}

export default function SeasonalityTab({ setStatus }) {
  const [universe, setUniverse] = useState({ countries: [], sectors: [] });
  const [sources, setSources] = useState([]);

  const [universeType, setUniverseType] = useState("SECTOR"); // "COUNTRY" | "SECTOR"
  const [selectedSectors, setSelectedSectors] = useState(new Set());
  const [selectedCountries, setSelectedCountries] = useState(new Set());
  const [manualTicker, setManualTicker] = useState("");
  const [manualTickers, setManualTickers] = useState([]);
  const [currencyMode, setCurrencyMode] = useState("USD");

  const [dataSource, setDataSource] = useState("YAHOO_FINANCE");
  const [yearFrom, setYearFrom] = useState(DEFAULT_YEAR_FROM);
  const [yearTo, setYearTo] = useState(DEFAULT_YEAR_TO);
  const [signalStartMonth, setSignalStartMonth] = useState(1);
  const [signalLengthMonths, setSignalLengthMonths] = useState(2);
  const [minAssetsPerYear, setMinAssetsPerYear] = useState(4);

  const [testResult, setTestResult] = useState(null);
  const [sweepResult, setSweepResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);
  const [sweepLoading, setSweepLoading] = useState(false);
  const [audit, setAudit] = useState(null);

  // Combinatorial optimizer ("Monte Carlo" per the user's ask) — tries every valid
  // (universe, signal window) combination and ranks by risk-adjusted return. Always USD:
  // mixing currencies into one return/volatility ranking across countries and sectors
  // wouldn't be a fair comparison, same reasoning as the fixed S&P 500/MSCI benchmarks above.
  const [mcUniverses, setMcUniverses] = useState(new Set(["SECTOR", "COUNTRY"]));
  const [mcLengths, setMcLengths] = useState(new Set([1, 2, 3]));
  const [mcYearFrom, setMcYearFrom] = useState(DEFAULT_YEAR_FROM);
  const [mcYearTo, setMcYearTo] = useState(DEFAULT_YEAR_TO);
  const [mcMinAssetsPerYear, setMcMinAssetsPerYear] = useState(2);
  // "ROTATING" (default) re-picks the top quartile of the WHOLE universe every year, like the
  // strategy above. "FIXED" commits to the same mcFixedSize tickers for the whole period,
  // held together. "ROTATING_SUBSET" restricts that same rotation logic to a chosen group of
  // mcFixedSize tickers instead of the whole universe — e.g. size 2 reproduces "always hold
  // whichever of these two led", searched over every possible pair instead of picked by hand.
  const [mcMode, setMcMode] = useState("ROTATING");
  const [mcFixedSize, setMcFixedSize] = useState(3);
  // Restricts every window tested to start in January — off by default (sweeps all 12 months
  // to find seasonality effects anywhere in the year), but useful to isolate "which assets"
  // from "which month" when comparing against a hand-picked Jan-Feb test elsewhere on the page.
  const [mcForceJanuary, setMcForceJanuary] = useState(false);
  // A combo built on very few years (e.g. a pair involving a ticker that only started trading
  // recently) can show a deceptively high score from a short, lucky sample. Null = let the
  // backend default to half the requested year range.
  const [mcMinYearsUsed, setMcMinYearsUsed] = useState(null);
  const [mcResult, setMcResult] = useState(null);
  const [mcLoading, setMcLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [u, s] = await Promise.all([api.getSeasonalityUniverse(), api.getSeasonalitySources()]);
        setUniverse(u);
        setSources(s);
        const defaultSectors = new Set(u.sectors.map((a) => a.ticker));
        setSelectedSectors(defaultSectors);
        // Auto-run once with the default config, so the user sees output first.
        runTest({ tickersOverride: [...defaultSectors] });
      } catch (e) {
        setStatus({ type: "error", text: `No se pudo cargar el universo de activos: ${e.message}` });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTickers = useMemo(() => {
    const base = universeType === "SECTOR" ? [...selectedSectors] : [...selectedCountries];
    return [...new Set([...base, ...manualTickers])];
  }, [universeType, selectedSectors, selectedCountries, manualTickers]);

  // If the user trims the universe down (e.g. to just 2 sectors to compare head-to-head),
  // a stale higher "mínimo de activos/año" would silently zero out every year's stats —
  // clamp it down automatically so a 2-asset comparison actually produces numbers. Never
  // raises it back up on its own, so a deliberately strict threshold on a big universe is
  // left alone when more assets get added later.
  useEffect(() => {
    if (activeTickers.length >= 2 && minAssetsPerYear > activeTickers.length) {
      setMinAssetsPerYear(activeTickers.length);
    }
  }, [activeTickers.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(set, setSet, ticker) {
    const next = new Set(set);
    if (next.has(ticker)) next.delete(ticker);
    else next.add(ticker);
    setSet(next);
  }

  function addManualTicker() {
    const t = manualTicker.trim().toUpperCase();
    if (!t) return;
    if (!manualTickers.includes(t)) setManualTickers([...manualTickers, t]);
    setManualTicker("");
  }

  function removeManualTicker(t) {
    setManualTickers(manualTickers.filter((x) => x !== t));
  }

  async function runTest({ tickersOverride } = {}) {
    const tickers = tickersOverride || activeTickers;
    if (tickers.length < 2) {
      setStatus({ type: "error", text: "Elegí al menos 2 activos." });
      return;
    }
    setTestLoading(true);
    setStatus(null);
    try {
      const result = await api.runSeasonalityTest({
        tickers,
        dataSource,
        currencyMode: universeType === "COUNTRY" ? currencyMode : "USD",
        yearFrom,
        yearTo,
        signalStartMonth,
        signalLengthMonths,
        minAssetsPerYear,
      });
      setTestResult(result);
    } catch (e) {
      setStatus({ type: "error", text: `Falló el test: ${e.message}` });
    } finally {
      setTestLoading(false);
    }
  }

  async function runSweep() {
    if (activeTickers.length < 2) {
      setStatus({ type: "error", text: "Elegí al menos 2 activos para el barrido de ventanas." });
      return;
    }
    setSweepLoading(true);
    setStatus(null);
    try {
      const result = await api.runSeasonalitySweep({
        tickers: activeTickers,
        dataSource,
        currencyMode: universeType === "COUNTRY" ? currencyMode : "USD",
        yearFrom,
        yearTo,
        minAssetsPerYear,
      });
      setSweepResult(result);
    } catch (e) {
      setStatus({ type: "error", text: `Falló el barrido de ventanas: ${e.message}` });
    } finally {
      setSweepLoading(false);
    }
  }

  function toggleInSet(set, setSet, value) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setSet(next);
  }

  async function runMonteCarlo() {
    if (mcUniverses.size === 0) {
      setStatus({ type: "error", text: "Elegí al menos un universo (sectores y/o países) para el Monte Carlo." });
      return;
    }
    if (mcLengths.size === 0) {
      setStatus({ type: "error", text: "Elegí al menos una duración de ventana para probar." });
      return;
    }
    if (mcYearFrom > mcYearTo) {
      setStatus({ type: "error", text: "El año inicial del Monte Carlo no puede ser mayor que el año final." });
      return;
    }
    if ((mcMode === "FIXED" || mcMode === "ROTATING_SUBSET") && (!mcFixedSize || mcFixedSize < 2)) {
      setStatus({ type: "error", text: "Para este modo, elegí una cantidad de activos de al menos 2." });
      return;
    }
    setMcLoading(true);
    setStatus(null);
    try {
      const result = await api.runSeasonalityMonteCarlo({
        universes: [...mcUniverses],
        dataSource,
        currencyMode: "USD",
        yearFrom: mcYearFrom,
        yearTo: mcYearTo,
        minAssetsPerYear: mcMinAssetsPerYear,
        lengthMonths: [...mcLengths],
        startMonths: mcForceJanuary ? [1] : undefined,
        mode: mcMode,
        fixedSize: mcMode === "FIXED" || mcMode === "ROTATING_SUBSET" ? mcFixedSize : undefined,
        minYearsUsed: mcMinYearsUsed,
      });
      setMcResult(result);
    } catch (e) {
      setStatus({ type: "error", text: `Falló el Monte Carlo: ${e.message}` });
    } finally {
      setMcLoading(false);
    }
  }

  return (
    <div>
      <div style={ui.card}>
        <h2 style={ui.cardTitle}>Laboratorio de hipótesis de estacionalidad</h2>
        <p style={ui.cardSubtitle}>
          ¿Los activos que rentan mejor en una ventana temprana del año terminan liderando el resto del año? Elegí un
          universo, una fuente de datos, y una ventana de señal (por defecto enero-febrero) para probarlo.
        </p>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {/* Universe picker */}
        <div style={{ ...ui.card, flex: 1, minWidth: 300 }}>
          <h3 style={ui.cardTitle}>Universo</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              style={ui.button(universeType === "SECTOR" ? "primary" : "secondary")}
              onClick={() => setUniverseType("SECTOR")}
            >
              Sectores
            </button>
            <button
              style={ui.button(universeType === "COUNTRY" ? "primary" : "secondary")}
              onClick={() => setUniverseType("COUNTRY")}
            >
              Países
            </button>
          </div>

          {universeType === "COUNTRY" && (
            <div style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: colors.textMuted }}>Divisa:</span>
              <button style={ui.button(currencyMode === "USD" ? "primary" : "secondary")} onClick={() => setCurrencyMode("USD")}>
                USD
              </button>
              <button style={ui.button(currencyMode === "LOCAL" ? "primary" : "secondary")} onClick={() => setCurrencyMode("LOCAL")}>
                Moneda local
              </button>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, maxHeight: 220, overflowY: "auto" }}>
            {(universeType === "SECTOR" ? universe.sectors : universe.countries).map((a) => {
              const set = universeType === "SECTOR" ? selectedSectors : selectedCountries;
              const setSet = universeType === "SECTOR" ? setSelectedSectors : setSelectedCountries;
              return (
                <label key={a.ticker} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={set.has(a.ticker)} onChange={() => toggle(set, setSet, a.ticker)} />
                  {a.label} <span style={{ color: colors.textMuted }}>({a.ticker})</span>
                </label>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              style={{ ...ui.input, flex: 1 }}
              placeholder="Ticker manual, ej. NVDA"
              value={manualTicker}
              onChange={(e) => setManualTicker(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addManualTicker()}
            />
            <button style={ui.button("secondary")} onClick={addManualTicker}>
              + Agregar
            </button>
          </div>
          {manualTickers.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {manualTickers.map((t) => (
                <span key={t} style={{ ...ui.badge("neutral"), cursor: "pointer" }} onClick={() => removeManualTicker(t)}>
                  {t} ✕
                </span>
              ))}
            </div>
          )}
          <p style={{ ...ui.muted, marginTop: 10 }}>{activeTickers.length} activos seleccionados.</p>
        </div>

        {/* Test config */}
        <div style={{ ...ui.card, flex: 1, minWidth: 300 }}>
          <h3 style={ui.cardTitle}>Configuración</h3>
          <div style={ui.row}>
            <label style={ui.label}>
              Fuente de datos
              <select style={ui.input} value={dataSource} onChange={(e) => setDataSource(e.target.value)}>
                {sources.map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.available}>
                    {s.name} {!s.available ? "(próximamente)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ ...ui.row, marginTop: 10 }}>
            <label style={ui.label}>
              Años desde
              <input style={ui.input} type="number" value={yearFrom} onChange={(e) => setYearFrom(Number(e.target.value))} />
            </label>
            <label style={ui.label}>
              Años hasta
              <input style={ui.input} type="number" value={yearTo} onChange={(e) => setYearTo(Number(e.target.value))} />
            </label>
          </div>
          <div style={{ ...ui.row, marginTop: 10 }}>
            <label style={ui.label}>
              Ventana de señal — mes inicio
              <select style={ui.input} value={signalStartMonth} onChange={(e) => setSignalStartMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((m, i) => (
                  <option key={i} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label style={ui.label}>
              Duración (meses)
              <select style={ui.input} value={signalLengthMonths} onChange={(e) => setSignalLengthMonths(Number(e.target.value))}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ ...ui.row, marginTop: 10 }}>
            <label style={ui.label}>
              Mínimo de activos/año
              <input
                style={ui.input}
                type="number"
                min={2}
                value={minAssetsPerYear}
                onChange={(e) => setMinAssetsPerYear(Number(e.target.value))}
              />
            </label>
          </div>
          {activeTickers.length === 2 && (
            <p style={{ ...ui.muted, marginTop: 10 }}>
              Con solo 2 activos el "cuartil superior" es directamente el que ganó ese año — es una comparación
              cabeza a cabeza, no una estadística de cuartiles propiamente dicha.
            </p>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button style={ui.button("primary")} onClick={() => runTest()} disabled={testLoading}>
              {testLoading ? "Corriendo…" : "Correr test"}
            </button>
            <button style={ui.button("secondary")} onClick={runSweep} disabled={sweepLoading}>
              {sweepLoading ? "Corriendo…" : "Barrido de ventanas"}
            </button>
          </div>
        </div>
      </div>

      {testResult && <TestResults result={testResult} onAudit={setAudit} />}
      {sweepResult && <SweepResults result={sweepResult} />}

      <MonteCarloSection
        mcUniverses={mcUniverses}
        setMcUniverses={setMcUniverses}
        mcLengths={mcLengths}
        setMcLengths={setMcLengths}
        mcYearFrom={mcYearFrom}
        setMcYearFrom={setMcYearFrom}
        mcYearTo={mcYearTo}
        setMcYearTo={setMcYearTo}
        mcMinAssetsPerYear={mcMinAssetsPerYear}
        setMcMinAssetsPerYear={setMcMinAssetsPerYear}
        mcMode={mcMode}
        setMcMode={setMcMode}
        mcFixedSize={mcFixedSize}
        setMcFixedSize={setMcFixedSize}
        mcForceJanuary={mcForceJanuary}
        setMcForceJanuary={setMcForceJanuary}
        mcMinYearsUsed={mcMinYearsUsed}
        setMcMinYearsUsed={setMcMinYearsUsed}
        mcLoading={mcLoading}
        onRun={runMonteCarlo}
        mcResult={mcResult}
        toggleInSet={toggleInSet}
      />

      <AuditPanel audit={audit} onClose={() => setAudit(null)} />
    </div>
  );
}

function DataBadge({ meta }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      <span style={ui.badge("success")}>{meta.source}</span>
      <span style={ui.badge("neutral")}>{meta.currency}</span>
      <span style={ui.badge("neutral")}>
        {meta.yearFrom}–{meta.yearTo}
      </span>
      <span style={ui.badge("primary")}>
        Señal: {MONTH_NAMES[meta.signalStartMonth - 1]}–
        {MONTH_NAMES[(meta.signalStartMonth - 1 + meta.signalLengthMonths - 1) % 12]}
      </span>
    </div>
  );
}

function CoverageStrip({ coverage, tickers, yearFrom, yearTo }) {
  const years = [];
  for (let y = yearFrom; y <= yearTo; y++) years.push(y);
  const byKey = new Map(coverage.byTickerYear.map((r) => [`${r.ticker}-${r.year}`, r.covered]));
  const insufficientYears = new Set(coverage.byYear.filter((r) => !r.sufficient).map((r) => r.year));

  const cells = tickers.map((t) =>
    years.map((y) => {
      const covered = byKey.get(`${t}-${y}`);
      const flagged = insufficientYears.has(y);
      return {
        label: covered ? "✓" : "",
        color: !covered ? colors.surfaceAlt : flagged ? colors.warningSoft : colors.successSoft,
        title: `${t} ${y}: ${covered ? "con datos" : "sin datos"}${flagged ? " — año con pocos activos" : ""}`,
      };
    })
  );

  return (
    <div style={ui.card}>
      <h3 style={ui.cardTitle}>Cobertura de datos</h3>
      <p style={ui.cardSubtitle}>
        Años en <span style={{ background: colors.warningSoft, padding: "0 4px" }}>amarillo</span> tienen menos activos
        con datos que el mínimo configurado — se excluyen de las estadísticas.
      </p>
      <div style={ui.tableScroll}>
        <HeatmapGrid rowLabels={tickers} colLabels={years} cells={cells} cellWidth={34} rowLabelWidth={70} />
      </div>
    </div>
  );
}

function CorrelationBlock({ title, corr, points, xLabel, yLabel }) {
  return (
    <div style={{ flex: 1, minWidth: 320 }}>
      <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{title}</h4>
      <ScatterChart points={points} rho={corr.rho} pValue={corr.pValue} n={corr.n} xLabel={xLabel} yLabel={yLabel} />
    </div>
  );
}

function PersistenceTable({ persistenceRest, persistenceFullYear }) {
  return (
    <div style={ui.tableScroll}>
      <table style={ui.table}>
        <thead>
          <tr>
            <th style={ui.th}>Comparación</th>
            <th style={ui.th}>Persistencia observada</th>
            <th style={ui.th}>Esperado al azar</th>
            <th style={ui.th}>Años usados</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={ui.td}>Resto del año</td>
            <td style={{ ...ui.td, fontWeight: 700 }}>{pct(persistenceRest.average)}</td>
            <td style={ui.td}>{pct(persistenceRest.expectedRandom)}</td>
            <td style={ui.td}>{persistenceRest.yearsUsed}</td>
          </tr>
          <tr>
            <td style={ui.td}>Año completo</td>
            <td style={{ ...ui.td, fontWeight: 700 }}>{pct(persistenceFullYear.average)}</td>
            <td style={ui.td}>{pct(persistenceFullYear.expectedRandom)}</td>
            <td style={ui.td}>{persistenceFullYear.yearsUsed}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const HEATMAP_FIELD_META = {
  signalReturn: { auditField: "signalAudit", label: "Retorno — ventana de señal" },
  restReturn: { auditField: "restAudit", label: "Retorno — resto del año" },
  fullYearReturn: { auditField: "fullYearAudit", label: "Retorno — año completo" },
};

function RankingHeatmaps({ panel, tickers, yearFrom, yearTo, onAudit }) {
  const years = [];
  for (let y = yearFrom; y <= yearTo; y++) years.push(y);
  const byKey = new Map(panel.map((p) => [`${p.ticker}-${p.year}`, p]));

  // Per year, who had the best signal-window return — the "winner" the user asked to see.
  const winnerByYear = new Map();
  for (const y of years) {
    let best = null;
    for (const t of tickers) {
      const p = byKey.get(`${t}-${y}`);
      if (p && p.signalReturn !== null && (best === null || p.signalReturn > best.signalReturn)) {
        best = { ticker: t, signalReturn: p.signalReturn };
      }
    }
    if (best) winnerByYear.set(y, best.ticker);
  }

  function buildCells(field, { highlightWinner = false } = {}) {
    const { auditField, label } = HEATMAP_FIELD_META[field];
    return tickers.map((t) =>
      years.map((y) => {
        const p = byKey.get(`${t}-${y}`);
        const v = p ? p[field] : null;
        const isWinner = highlightWinner && winnerByYear.get(y) === t;
        const componentAudit = p ? p[auditField] : null;
        return {
          label: v === null || v === undefined ? "" : `${isWinner ? "*" : ""}${(v * 100).toFixed(0)}%`,
          color: v === null || v === undefined ? colors.surfaceAlt : divergingColor(v, 0.4),
          title: p
            ? `${t} ${y}: ${(v * 100).toFixed(1)}%${isWinner ? " — ganador de la ventana de señal ese año" : ""} — click para auditar`
            : "sin datos",
          onClick:
            componentAudit && componentAudit.value !== null
              ? () => onAudit({ title: `${t} · ${y}`, subtitle: label, components: [componentAudit] })
              : undefined,
        };
      })
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>
          Retorno — ventana de señal <span style={{ fontWeight: 400, color: colors.textMuted }}>(* = ganador del año)</span>
        </h4>
        <div style={ui.tableScroll}>
          <HeatmapGrid
            rowLabels={tickers}
            colLabels={years}
            cells={buildCells("signalReturn", { highlightWinner: true })}
            cellWidth={48}
            rowLabelWidth={70}
          />
        </div>
      </div>
      <div>
        <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>Retorno — resto del año</h4>
        <div style={ui.tableScroll}>
          <HeatmapGrid rowLabels={tickers} colLabels={years} cells={buildCells("restReturn")} cellWidth={44} rowLabelWidth={70} />
        </div>
      </div>
      <div>
        <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>Retorno — año completo</h4>
        <div style={ui.tableScroll}>
          <HeatmapGrid rowLabels={tickers} colLabels={years} cells={buildCells("fullYearReturn")} cellWidth={44} rowLabelWidth={70} />
        </div>
      </div>
      <p style={{ ...ui.muted, margin: 0 }}>Click en cualquier celda con valor para ver el cálculo exacto (fechas y precios usados).</p>
    </div>
  );
}

// Footer row for the per-year strategy tables: how many years the differential came out
// positive vs. negative, out of the years with actual data (a quick "does this beat the
// benchmark more often than not" tally), plus the total alpha actually generated over the
// whole period — the spread between the strategy's and the benchmark's TOTAL compounded
// return (last point of the cumulative curve), not a sum or average of the yearly diffs.
// That distinction matters: compounding means the two aren't the same number.
function DiffScoreRow({ perYear, diffKey, cumulative, strategyCumKey, benchmarkCumKey, colSpan }) {
  const rows = perYear.filter((r) => r[diffKey] !== null && r[diffKey] !== undefined);
  const positive = rows.filter((r) => r[diffKey] >= 0).length;
  const pctPositive = rows.length ? Math.round((positive / rows.length) * 100) : 0;

  const lastCumulative = cumulative && cumulative.length ? cumulative[cumulative.length - 1] : null;
  const hasAlpha = lastCumulative && lastCumulative[strategyCumKey] !== undefined && lastCumulative[benchmarkCumKey] !== undefined;
  const totalAlpha = hasAlpha ? lastCumulative[strategyCumKey] - lastCumulative[benchmarkCumKey] : null;

  return (
    <tr>
      <td
        colSpan={colSpan}
        style={{
          ...ui.td,
          borderTop: `2px solid ${colors.border}`,
          borderBottom: "none",
          whiteSpace: "normal",
        }}
      >
        <div style={{ fontWeight: 700, color: colors.text }}>
          {positive}/{rows.length} años con diferencial positivo ({pctPositive}%)
        </div>
        {hasAlpha && (
          <div style={{ marginTop: 4, fontWeight: 700, color: totalAlpha >= 0 ? colors.success : colors.danger }}>
            Alfa total generado: {totalAlpha >= 0 ? "+" : ""}
            {pct(totalAlpha)}{" "}
            <span style={{ fontWeight: 400, color: colors.textMuted }}>
              (rentabilidad acumulada de todo el período: cuartil superior menos benchmark)
            </span>
          </div>
        )}
      </td>
    </tr>
  );
}

function TestResults({ result, onAudit }) {
  const { meta, panel, coverage, correlationVsRest, correlationVsFullYear, persistenceVsRest, persistenceVsFullYear, strategy } = result;
  const tickers = meta.tickers;

  const restPoints = panel
    .filter((p) => p.signalReturn !== null && p.restReturn !== null && p.covered)
    .map((p) => ({ x: p.signalReturn, y: p.restReturn, label: `${p.ticker} ${p.year}` }));
  const fullYearPoints = panel
    .filter((p) => p.signalReturn !== null && p.fullYearReturn !== null && p.covered)
    .map((p) => ({ x: p.signalReturn, y: p.fullYearReturn, label: `${p.ticker} ${p.year}` }));

  return (
    <div>
      <div style={ui.card}>
        <DataBadge meta={meta} />
        <p style={ui.muted}>
          El p-value de la correlación contra "año completo" suele salir más bajo (más "significativo") porque la
          ventana de señal ya es parte del año completo — eso es aritmética, no persistencia. La comparación contra
          "resto del año" es la que aísla si el efecto persiste una vez terminada la ventana de señal.
        </p>
      </div>

      <CoverageStrip coverage={coverage} tickers={tickers} yearFrom={meta.yearFrom} yearTo={meta.yearTo} />

      <div style={ui.card}>
        <h3 style={ui.cardTitle}>Heatmap de retornos por año</h3>
        <RankingHeatmaps panel={panel} tickers={tickers} yearFrom={meta.yearFrom} yearTo={meta.yearTo} onAudit={onAudit} />
      </div>

      <div style={ui.card}>
        <h3 style={ui.cardTitle}>Correlación señal vs. comparación (Spearman)</h3>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <CorrelationBlock
            title="Señal vs. resto del año"
            corr={correlationVsRest}
            points={restPoints}
            xLabel="Retorno ventana de señal"
            yLabel="Retorno resto del año"
          />
          <CorrelationBlock
            title="Señal vs. año completo"
            corr={correlationVsFullYear}
            points={fullYearPoints}
            xLabel="Retorno ventana de señal"
            yLabel="Retorno año completo"
          />
        </div>
      </div>

      <div style={ui.card}>
        <h3 style={ui.cardTitle}>Persistencia de cuartiles</h3>
        <p style={ui.cardSubtitle}>
          % de los activos en el cuartil superior de la ventana de señal que se mantiene en el cuartil superior de la
          ventana de comparación. 25% es lo esperado si no hay relación.
        </p>
        <PersistenceTable persistenceRest={persistenceVsRest} persistenceFullYear={persistenceVsFullYear} />
      </div>

      <div style={ui.card}>
        <h3 style={ui.cardTitle}>Rendimiento de la estrategia</h3>
        <p style={ui.cardSubtitle}>
          Cartera equiponderada del cuartil superior por señal, comprada al terminar la ventana de señal y mantenida
          hasta fin de año, contra el universo equiponderado completo en el mismo período (evita look-ahead bias). S&amp;P
          500 (SPY) y MSCI World (URTH) se agregan como referencia fija, con la misma metodología — siempre en USD, sin
          importar la divisa del test.
          {!strategy.sp500Available || !strategy.msciWorldAvailable ? (
            <>
              {" "}
              {!strategy.sp500Available && "S&P 500 no se muestra"}
              {!strategy.sp500Available && !strategy.msciWorldAvailable && " y "}
              {!strategy.msciWorldAvailable && "MSCI World (URTH, cotiza desde 2012) no se muestra"} porque no tiene
              datos para todo el rango de años pedido.
            </>
          ) : null}
        </p>
        <LineChart
          points={strategy.cumulative}
          series={[
            { key: "cumulativeStrategy", label: "Cuartil superior", color: colors.primary },
            { key: "cumulativeBenchmark", label: "Universo", color: colors.textMuted },
            ...(strategy.sp500Available ? [{ key: "cumulativeSp500", label: "S&P 500", color: colors.warning }] : []),
            ...(strategy.msciWorldAvailable ? [{ key: "cumulativeMsciWorld", label: "MSCI World", color: "#a78bfa" }] : []),
          ]}
        />

        <div style={{ ...ui.tableScroll, marginTop: 12 }}>
          <table style={ui.table}>
            <thead>
              <tr>
                <th style={ui.th}>Serie</th>
                <th style={ui.th}>Volatilidad anualizada</th>
                <th style={ui.th}>Máximo drawdown</th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: "strategy", label: "Cuartil superior", show: true },
                { key: "benchmark", label: "Universo", show: true },
                { key: "sp500", label: "S&P 500", show: strategy.sp500Available },
                { key: "msciWorld", label: "MSCI World", show: strategy.msciWorldAvailable },
              ]
                .filter((s) => s.show && strategy.stats[s.key])
                .map((s) => (
                  <tr key={s.key}>
                    <td style={ui.td}>{s.label}</td>
                    <td style={ui.td}>{pct(strategy.stats[s.key].volatility)}</td>
                    <td style={{ ...ui.td, color: colors.danger, fontWeight: 700 }}>
                      {pct(strategy.stats[s.key].maxDrawdown)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p style={ui.muted}>
          Volatilidad = desviación estándar de los retornos DIARIOS reales de la cartera equiponderada durante los
          períodos que efectivamente se mantiene cada año, anualizada (×√252) — no un promedio de retornos anuales.
          Máximo drawdown = la mayor caída desde un pico hasta un valle en la curva acumulada de cada serie (columna
          "Drawdown" en las tablas de abajo para ver año por año).
        </p>

        <div style={{ ...ui.tableScroll, marginTop: 12 }}>
          <table style={ui.table}>
            <thead>
              <tr>
                <th style={ui.th}>Año</th>
                <th style={ui.th}>Cuartil superior</th>
                <th style={ui.th}>Universo</th>
                <th style={ui.th}>Diferencial</th>
                <th style={ui.th}>Max Drawdown (cuartil sup.)</th>
              </tr>
            </thead>
            <tbody>
              {strategy.perYear.map((r) => (
                <tr key={r.year}>
                  <td style={ui.td}>{r.year}</td>
                  <td
                    style={{ ...ui.td, ...auditableCell }}
                    title="Click para auditar este número"
                    onClick={() =>
                      onAudit({ title: `Cuartil superior · ${r.year}`, subtitle: "Retorno resto del año (equiponderado)", components: r.strategyReturnAudit })
                    }
                  >
                    {pct(r.strategyReturn)}
                  </td>
                  <td
                    style={{ ...ui.td, ...auditableCell }}
                    title="Click para auditar este número"
                    onClick={() =>
                      onAudit({ title: `Universo · ${r.year}`, subtitle: "Retorno resto del año (equiponderado, todo el universo)", components: r.benchmarkReturnAudit })
                    }
                  >
                    {pct(r.benchmarkReturn)}
                  </td>
                  <td style={{ ...ui.td, color: r.diff >= 0 ? colors.success : colors.danger, fontWeight: 700 }}>
                    {r.diff >= 0 ? "+" : ""}
                    {pct(r.diff)}
                  </td>
                  <td style={{ ...ui.td, color: r.strategyDrawdown < 0 ? colors.danger : colors.textMuted }}>
                    {pct(r.strategyDrawdown)}
                  </td>
                </tr>
              ))}
              <DiffScoreRow
                perYear={strategy.perYear}
                diffKey="diff"
                cumulative={strategy.cumulative}
                strategyCumKey="cumulativeStrategy"
                benchmarkCumKey="cumulativeBenchmark"
                colSpan={5}
              />
            </tbody>
          </table>
        </div>

        {strategy.sp500Available && (
          <div style={{ ...ui.tableScroll, marginTop: 16 }}>
            <table style={ui.table}>
              <thead>
                <tr>
                  <th style={ui.th}>Año</th>
                  <th style={ui.th}>Cuartil superior</th>
                  <th style={ui.th}>S&amp;P 500</th>
                  <th style={ui.th}>Diferencial</th>
                  <th style={ui.th}>Max Drawdown (cuartil sup.)</th>
                  <th style={ui.th}>Max Drawdown (S&amp;P 500)</th>
                </tr>
              </thead>
              <tbody>
                {strategy.perYear.map((r) => (
                  <tr key={r.year}>
                    <td style={ui.td}>{r.year}</td>
                    <td
                      style={{ ...ui.td, ...auditableCell }}
                      title="Click para auditar este número"
                      onClick={() =>
                        onAudit({ title: `Cuartil superior · ${r.year}`, subtitle: "Retorno resto del año (equiponderado)", components: r.strategyReturnAudit })
                      }
                    >
                      {pct(r.strategyReturn)}
                    </td>
                    <td
                      style={{ ...ui.td, ...auditableCell }}
                      title="Click para auditar este número"
                      onClick={() =>
                        onAudit({ title: `S&P 500 · ${r.year}`, subtitle: "Retorno resto del año (SPY, USD)", components: r.sp500ReturnAudit })
                      }
                    >
                      {pct(r.sp500Return)}
                    </td>
                    <td style={{ ...ui.td, color: r.diffVsSp500 >= 0 ? colors.success : colors.danger, fontWeight: 700 }}>
                      {r.diffVsSp500 >= 0 ? "+" : ""}
                      {pct(r.diffVsSp500)}
                    </td>
                    <td style={{ ...ui.td, color: r.strategyDrawdown < 0 ? colors.danger : colors.textMuted }}>
                      {pct(r.strategyDrawdown)}
                    </td>
                    <td style={{ ...ui.td, color: r.sp500Drawdown < 0 ? colors.danger : colors.textMuted }}>
                      {pct(r.sp500Drawdown)}
                    </td>
                  </tr>
                ))}
                <DiffScoreRow
                  perYear={strategy.perYear}
                  diffKey="diffVsSp500"
                  cumulative={strategy.cumulative}
                  strategyCumKey="cumulativeStrategy"
                  benchmarkCumKey="cumulativeSp500"
                  colSpan={6}
                />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SweepResults({ result }) {
  const { meta, cells } = result;
  const byKey = new Map(cells.map((c) => [`${c.startMonth}-${c.lengthMonths}`, c]));
  const lengths = [1, 2, 3];

  const grid = MONTH_NAMES.map((_, monthIdx) =>
    lengths.map((len) => {
      const c = byKey.get(`${monthIdx + 1}-${len}`);
      if (!c) return { label: "—", color: colors.surfaceAlt, title: "ventana cruza fin de año — excluida" };
      return {
        label: c.rho === null ? "n/d" : c.rho.toFixed(2),
        color: c.rho === null ? colors.surfaceAlt : divergingColor(c.rho, 0.5),
        title: `Inicio ${MONTH_NAMES[monthIdx]}, ${len} mes(es): ρ=${c.rho?.toFixed(3) ?? "n/d"} (n=${c.n})`,
      };
    })
  );

  return (
    <div style={ui.card}>
      <h3 style={ui.cardTitle}>Barrido de ventanas</h3>
      <p style={ui.cardSubtitle}>
        Correlación de Spearman (señal vs. resto del año) para ventanas de 1, 2 y 3 meses empezando en cada mes. Si
        enero-febrero se destaca frente al resto, el efecto es estacional; si todas las ventanas de 2 meses se
        parecen, es momentum genérico.
      </p>
      <div style={ui.tableScroll}>
        <HeatmapGrid
          rowLabels={MONTH_NAMES}
          colLabels={["1 mes", "2 meses", "3 meses"]}
          cells={grid}
          cellWidth={70}
          rowLabelWidth={50}
        />
      </div>
      <p style={{ ...ui.muted, marginTop: 8 }}>
        Fuente: {meta.source} · {meta.yearFrom}–{meta.yearTo} · {meta.comparison}
      </p>
    </div>
  );
}

function MonteCarloSection({
  mcUniverses,
  setMcUniverses,
  mcLengths,
  setMcLengths,
  mcYearFrom,
  setMcYearFrom,
  mcYearTo,
  setMcYearTo,
  mcMinAssetsPerYear,
  setMcMinAssetsPerYear,
  mcMode,
  setMcMode,
  mcFixedSize,
  setMcFixedSize,
  mcForceJanuary,
  setMcForceJanuary,
  mcMinYearsUsed,
  setMcMinYearsUsed,
  mcLoading,
  onRun,
  mcResult,
  toggleInSet,
}) {
  const needsSize = mcMode === "FIXED" || mcMode === "ROTATING_SUBSET";
  const defaultMinYears = Math.max(2, Math.round((mcYearTo - mcYearFrom + 1) / 2));
  return (
    <div style={ui.card}>
      <h2 style={ui.cardTitle}>Optimización combinatoria (Monte Carlo)</h2>
      <p style={ui.cardSubtitle}>
        Prueba TODAS las combinaciones válidas de universo (sectores y/o países — nunca mezclados en una misma
        cartera) × ventana de señal (mes de inicio × duración), y las ordena por retorno ajustado por riesgo (CAGR ÷
        volatilidad) para encontrar cuál habría dado, históricamente, más rentabilidad con menos volatilidad. Es un
        barrido exhaustivo — evalúa cada combinación posible, no una muestra aleatoria — pero lo llamamos "Monte
        Carlo" siguiendo el pedido. Siempre en USD, para poder comparar sectores y países en una sola tabla.
      </p>

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, color: colors.textMuted, margin: "0 0 6px 0", fontWeight: 600 }}>Modo de selección de activos</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
            <input
              type="radio"
              name="mcMode"
              checked={mcMode === "ROTATING"}
              onChange={() => setMcMode("ROTATING")}
              style={{ marginTop: 2 }}
            />
            <span>
              <strong>Rotar cuartil superior de todo el universo</strong>
              <br />
              <span style={{ color: colors.textMuted }}>
                Re-elige el cuartil superior por señal de TODO el universo, todos los años (como la estrategia
                principal de arriba).
              </span>
            </span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
            <input
              type="radio"
              name="mcMode"
              checked={mcMode === "ROTATING_SUBSET"}
              onChange={() => setMcMode("ROTATING_SUBSET")}
              style={{ marginTop: 2 }}
            />
            <span>
              <strong>Rotar el ganador dentro de un grupo elegido</strong>
              <br />
              <span style={{ color: colors.textMuted }}>
                Elegí cuántos activos (2, 3, 4…) y busca, entre TODAS las combinaciones posibles de ese tamaño, el
                grupo donde "quedarme siempre con el/los que mejor vinieron viniendo en la señal" dio mejor
                resultado. Con 2 activos reproduce "siempre el ganador entre estos dos", probado para cada par
                posible — no uno elegido a mano.
              </span>
            </span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
            <input
              type="radio"
              name="mcMode"
              checked={mcMode === "FIXED"}
              onChange={() => setMcMode("FIXED")}
              style={{ marginTop: 2 }}
            />
            <span>
              <strong>Cartera fija (sin rotación)</strong>
              <br />
              <span style={{ color: colors.textMuted }}>
                Elegí cuántos activos y busca la combinación que dio mejor resultado manteniendo siempre los MISMOS
                activos todo el período (no rota entre ellos, los mantiene juntos).
              </span>
            </span>
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div style={{ minWidth: 160 }}>
          <p style={{ fontSize: 13, color: colors.textMuted, margin: "0 0 6px 0", fontWeight: 600 }}>Universo a explorar</p>
          {["SECTOR", "COUNTRY"].map((u) => (
            <label key={u} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer", marginBottom: 4 }}>
              <input type="checkbox" checked={mcUniverses.has(u)} onChange={() => toggleInSet(mcUniverses, setMcUniverses, u)} />
              {UNIVERSE_LABELS[u]}
            </label>
          ))}
        </div>

        <div style={{ minWidth: 160 }}>
          <p style={{ fontSize: 13, color: colors.textMuted, margin: "0 0 6px 0", fontWeight: 600 }}>Duración de ventana a probar</p>
          {[1, 2, 3].map((len) => (
            <label key={len} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer", marginBottom: 4 }}>
              <input type="checkbox" checked={mcLengths.has(len)} onChange={() => toggleInSet(mcLengths, setMcLengths, len)} />
              {len} mes{len > 1 ? "es" : ""}
            </label>
          ))}
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, cursor: "pointer", marginTop: 8 }}>
            <input type="checkbox" checked={mcForceJanuary} onChange={(e) => setMcForceJanuary(e.target.checked)} />
            Forzar inicio en enero
          </label>
        </div>

        <div style={ui.row}>
          <label style={ui.label}>
            Años desde
            <input style={ui.input} type="number" value={mcYearFrom} onChange={(e) => setMcYearFrom(Number(e.target.value))} />
          </label>
          <label style={ui.label}>
            Años hasta
            <input style={ui.input} type="number" value={mcYearTo} onChange={(e) => setMcYearTo(Number(e.target.value))} />
          </label>
          {needsSize ? (
            <label style={ui.label}>
              N° de activos
              <input
                style={ui.input}
                type="number"
                min={2}
                value={mcFixedSize}
                onChange={(e) => setMcFixedSize(Number(e.target.value))}
              />
            </label>
          ) : (
            <label style={ui.label}>
              Mínimo de activos/año
              <input
                style={ui.input}
                type="number"
                min={2}
                value={mcMinAssetsPerYear}
                onChange={(e) => setMcMinAssetsPerYear(Number(e.target.value))}
              />
            </label>
          )}
          <label style={ui.label}>
            Mínimo de años usados
            <input
              style={ui.input}
              type="number"
              min={2}
              placeholder={String(defaultMinYears)}
              value={mcMinYearsUsed ?? ""}
              onChange={(e) => setMcMinYearsUsed(e.target.value === "" ? null : Number(e.target.value))}
            />
          </label>
        </div>
      </div>
      <p style={{ ...ui.muted, marginTop: 10 }}>
        "Mínimo de años usados" descarta combinaciones armadas con muy pocos años (p. ej. un activo que empezó a
        cotizar hace poco) — sin ese piso, un resultado con solo 5-7 años de historia puede parecer mejor que otro
        con 20 años solo por casualidad de muestra chica. Vacío = la mitad del rango de años pedido ({defaultMinYears}
        {" "}en este caso).
      </p>

      <div style={{ marginTop: 16 }}>
        <button style={ui.button("primary")} onClick={onRun} disabled={mcLoading}>
          {mcLoading ? "Corriendo combinaciones…" : "Correr Monte Carlo"}
        </button>
      </div>

      {mcResult && <MonteCarloResults result={mcResult} />}
    </div>
  );
}

// picksByYear is identical every year in FIXED mode (same basket held throughout) but rotates
// year to year in ROTATING mode — these two helpers read that without the caller needing to
// know which mode produced the data.
function fixedTickersOf(picksByYear) {
  const years = Object.keys(picksByYear || {});
  return years.length ? picksByYear[years[0]] : null;
}

const MODE_LABELS = {
  ROTATING: "Rotación de todo el universo",
  ROTATING_SUBSET: `Rotación dentro de un grupo elegido`,
  FIXED: `Cartera fija`,
};

function MonteCarloResults({ result }) {
  const { meta, combos, best } = result;
  const [picksDetail, setPicksDetail] = useState(null);
  const isFixed = meta.mode === "FIXED";

  if (!combos || combos.length === 0) {
    return (
      <p style={{ ...ui.muted, marginTop: 16 }}>
        Ninguna combinación tuvo datos suficientes con esta configuración
        {meta.discardedForShortSample > 0 &&
          ` (${meta.discardedForShortSample} se descartaron por tener menos de ${meta.minYearsUsed} años de historia — bajá "Mínimo de años usados" si querés verlas)`}
        .
      </p>
    );
  }

  return (
    <div style={{ marginTop: 20 }}>
      <p style={ui.muted}>
        {meta.combosEvaluated} combinaciones evaluadas · {meta.source} · {meta.yearFrom}–{meta.yearTo} ·{" "}
        {MODE_LABELS[meta.mode] || meta.mode}
        {(meta.mode === "FIXED" || meta.mode === "ROTATING_SUBSET") && ` de ${meta.fixedSize} activos`}
        {meta.startMonths && meta.startMonths.length === 1 && meta.startMonths[0] === 1 && " · señal forzada a Enero"}
        {meta.discardedForShortSample > 0 &&
          ` · ${meta.discardedForShortSample} combinación(es) con menos de ${meta.minYearsUsed} años descartadas`}
      </p>

      {best && (
        <div
          onClick={() => setPicksDetail(best)}
          title={isFixed ? "Click para confirmar los activos elegidos" : "Click para ver qué activos eligió esta combinación cada año"}
          style={{
            background: colors.primarySoft,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: 16,
            marginTop: 8,
            marginBottom: 16,
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: colors.primary }}>
            Combinación óptima (mayor retorno ajustado por riesgo)
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
            {UNIVERSE_LABELS[best.universe]} · Señal {windowLabel(best.startMonth, best.lengthMonths)}
          </div>
          {isFixed && (
            <div style={{ marginTop: 8, fontSize: 14 }}>
              Activos: <strong>{(fixedTickersOf(best.picksByYear) || []).join(", ")}</strong>{" "}
              <span style={{ color: colors.textMuted, fontWeight: 400 }}>(los mismos todo el período, sin rotar)</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 10, fontSize: 13.5 }}>
            <span>
              CAGR: <strong style={{ color: best.cagr >= 0 ? colors.success : colors.danger }}>{pct(best.cagr)}</strong>
            </span>
            <span>
              Retorno total: <strong>{pct(best.totalReturn)}</strong>
            </span>
            <span>
              Volatilidad: <strong>{pct(best.volatility)}</strong>
            </span>
            <span>
              Max drawdown: <strong style={{ color: colors.danger }}>{pct(best.maxDrawdown)}</strong>
            </span>
            <span>
              Años usados: <strong>{best.yearsUsed}</strong>
            </span>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: colors.primary, fontWeight: 600 }}>
            {isFixed ? "Click para confirmar los activos elegidos" : "Click para ver qué activos eligió cada año"}
          </div>
        </div>
      )}

      <ComboScatter combos={combos} best={best} />

      <div style={{ ...ui.tableScroll, marginTop: 16 }}>
        <table style={ui.table}>
          <thead>
            <tr>
              <th style={ui.th}>Universo</th>
              <th style={ui.th}>Ventana de señal</th>
              <th style={ui.th}>CAGR</th>
              <th style={ui.th}>Retorno total</th>
              <th style={ui.th}>Volatilidad</th>
              <th style={ui.th}>Max Drawdown</th>
              <th style={ui.th}>Score (CAGR/Vol)</th>
              <th style={ui.th}>Años</th>
              <th style={ui.th}>Activos</th>
            </tr>
          </thead>
          <tbody>
            {combos.map((c, i) => (
              <tr key={`${c.universe}-${c.startMonth}-${c.lengthMonths}`} style={i === 0 ? { background: colors.primarySoft } : undefined}>
                <td style={ui.td}>
                  {i === 0 ? "* " : ""}
                  {UNIVERSE_LABELS[c.universe]}
                </td>
                <td style={ui.td}>{windowLabel(c.startMonth, c.lengthMonths)}</td>
                <td style={{ ...ui.td, color: c.cagr >= 0 ? colors.success : colors.danger, fontWeight: 700 }}>{pct(c.cagr)}</td>
                <td style={ui.td}>{pct(c.totalReturn)}</td>
                <td style={ui.td}>{pct(c.volatility)}</td>
                <td style={{ ...ui.td, color: colors.danger }}>{pct(c.maxDrawdown)}</td>
                <td style={ui.td}>{c.score.toFixed(2)}</td>
                <td style={ui.td}>{c.yearsUsed}</td>
                <td style={{ ...ui.td, whiteSpace: isFixed ? "normal" : "nowrap" }}>
                  {isFixed ? (
                    <span
                      style={{ ...auditableCell, color: colors.text }}
                      title="Click para confirmar los activos elegidos"
                      onClick={() => setPicksDetail(c)}
                    >
                      {(fixedTickersOf(c.picksByYear) || []).join(", ")}
                    </span>
                  ) : (
                    <button
                      style={{ ...ui.button("ghost"), height: "auto", padding: "2px 8px", fontSize: 12.5, color: colors.primary }}
                      onClick={() => setPicksDetail(c)}
                    >
                      Ver ▸
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ ...ui.muted, marginTop: 8 }}>
        Score = CAGR ÷ volatilidad anualizada (parecido a un Sharpe ratio, pero sin restar la tasa libre de riesgo) —
        se usa solo para ORDENAR las combinaciones entre sí, no es una métrica financiera estándar por sí sola. Esto
        es un backtest histórico: no garantiza que la misma combinación vaya a repetirse en el futuro.
      </p>

      {picksDetail && <ComboPicksDrawer detail={picksDetail} onClose={() => setPicksDetail(null)} />}
    </div>
  );
}

function ComboPicksDrawer({ detail, onClose }) {
  const years = Object.keys(detail.picksByYear || {})
    .map(Number)
    .sort((a, b) => a - b);

  // FIXED mode holds the exact same basket every year — detect that and show one consolidated
  // line instead of repeating an identical row per year, which would just look redundant.
  const signature = (list) => [...(list || [])].sort().join(",");
  const isConstant = years.length > 0 && years.every((y) => signature(detail.picksByYear[y]) === signature(detail.picksByYear[years[0]]));

  return (
    <Drawer
      kicker="Composición de la cartera"
      title={`${UNIVERSE_LABELS[detail.universe]} · Señal ${windowLabel(detail.startMonth, detail.lengthMonths)}`}
      subtitle={
        isConstant
          ? "Cartera fija: los mismos activos todos los años, comprados al empezar el mes de 'cartera desde' y mantenidos hasta el 31 de diciembre."
          : "Activos del cuartil superior por señal que esta combinación eligió cada año — comprados al empezar el mes de 'cartera desde', mantenidos hasta el 31 de diciembre."
      }
      onClose={onClose}
    >
      {years.length === 0 ? (
        <p style={ui.muted}>No hay datos de composición para esta combinación.</p>
      ) : isConstant ? (
        <div
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: 14,
            background: colors.surfaceAlt,
            fontSize: 14,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: colors.textMuted, marginBottom: 6 }}>
            Todos los años ({years[0]}–{years[years.length - 1]})
          </div>
          <strong>{(detail.picksByYear[years[0]] || []).join(", ")}</strong>
        </div>
      ) : (
        <div style={ui.tableScroll}>
          <table style={ui.table}>
            <thead>
              <tr>
                <th style={ui.th}>Año</th>
                <th style={ui.th}>Activos elegidos</th>
              </tr>
            </thead>
            <tbody>
              {years.map((year) => (
                <tr key={year}>
                  <td style={ui.td}>{year}</td>
                  <td style={{ ...ui.td, whiteSpace: "normal" }}>{(detail.picksByYear[year] || []).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}

function ComboScatter({ combos, best }) {
  const width = 640;
  const height = 320;
  const padding = { top: 16, right: 16, bottom: 40, left: 56 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xs = combos.map((c) => c.volatility);
  const ys = combos.map((c) => c.cagr);
  const xMin = 0;
  const xMax = Math.max(...xs) * 1.08 || 1;
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(...ys) * 1.08 || 0.01;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const sx = (v) => padding.left + ((v - xMin) / xRange) * plotWidth;
  const sy = (v) => padding.top + plotHeight - ((v - yMin) / yRange) * plotHeight;

  const zeroY = yMin <= 0 && yMax >= 0 ? sy(0) : null;

  return (
    <div style={ui.tableScroll}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", minWidth: 480 }}>
        {zeroY !== null && (
          <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke={colors.border} strokeDasharray="3 3" />
        )}

        {combos.map((c, i) => {
          const isBest =
            best && c.universe === best.universe && c.startMonth === best.startMonth && c.lengthMonths === best.lengthMonths;
          const color = c.universe === "COUNTRY" ? "#a78bfa" : colors.primary;
          return (
            <circle
              key={i}
              cx={sx(c.volatility)}
              cy={sy(c.cagr)}
              r={isBest ? 7 : 3.5}
              fill={isBest ? colors.success : color}
              opacity={isBest ? 1 : 0.55}
              stroke={isBest ? "#fff" : "none"}
              strokeWidth={isBest ? 2 : 0}
            >
              <title>
                {UNIVERSE_LABELS[c.universe]} · {windowLabel(c.startMonth, c.lengthMonths)}: CAGR {(c.cagr * 100).toFixed(1)}%, vol{" "}
                {(c.volatility * 100).toFixed(1)}%{isBest ? " — ÓPTIMO" : ""}
              </title>
            </circle>
          );
        })}

        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke={colors.text} />
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke={colors.text} />
        <text x={width / 2} y={height - 6} fontSize="11" fill={colors.textMuted} textAnchor="middle">
          Volatilidad anualizada
        </text>
        <text x={14} y={height / 2} fontSize="11" fill={colors.textMuted} textAnchor="middle" transform={`rotate(-90, 14, ${height / 2})`}>
          CAGR anualizado
        </text>

        <g transform={`translate(${width - 150}, ${padding.top})`}>
          <circle cx={6} cy={4} r={4} fill={colors.primary} />
          <text x={16} y={8} fontSize="11" fill={colors.textMuted}>
            Sectores
          </text>
          <circle cx={6} cy={20} r={4} fill="#a78bfa" />
          <text x={16} y={24} fontSize="11" fill={colors.textMuted}>
            Países
          </text>
          <circle cx={6} cy={36} r={5} fill={colors.success} stroke="#fff" strokeWidth={1.5} />
          <text x={16} y={40} fontSize="11" fill={colors.textMuted}>
            Óptimo
          </text>
        </g>
      </svg>
    </div>
  );
}
