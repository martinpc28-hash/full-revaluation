import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { ui, colors } from "../theme.js";
import HeatmapGrid, { divergingColor } from "../HeatmapGrid.jsx";
import ScatterChart from "../ScatterChart.jsx";
import LineChart from "../LineChart.jsx";
import AuditPanel from "../AuditPanel.jsx";

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

  return (
    <div>
      <div style={ui.card}>
        <h2 style={ui.cardTitle}>🔬 Laboratorio de hipótesis de estacionalidad</h2>
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
              {testLoading ? "Corriendo…" : "🚀 Correr test"}
            </button>
            <button style={ui.button("secondary")} onClick={runSweep} disabled={sweepLoading}>
              {sweepLoading ? "Corriendo…" : "📊 Barrido de ventanas"}
            </button>
          </div>
        </div>
      </div>

      {testResult && <TestResults result={testResult} onAudit={setAudit} />}
      {sweepResult && <SweepResults result={sweepResult} />}

      <AuditPanel audit={audit} onClose={() => setAudit(null)} />
    </div>
  );
}

function DataBadge({ meta }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      <span style={ui.badge("success")}>✅ {meta.source}</span>
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
        color: !covered ? "#f3f4f6" : flagged ? colors.warningSoft : colors.successSoft,
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
          label: v === null || v === undefined ? "" : `${isWinner ? "🏆" : ""}${(v * 100).toFixed(0)}%`,
          color: v === null || v === undefined ? "#f3f4f6" : divergingColor(v, 0.4),
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
          Retorno — ventana de señal <span style={{ fontWeight: 400, color: colors.textMuted }}>(🏆 = ganador del año)</span>
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
      <p style={{ ...ui.muted, margin: 0 }}>💡 Click en cualquier celda con valor para ver el cálculo exacto (fechas y precios usados).</p>
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
            ...(strategy.msciWorldAvailable ? [{ key: "cumulativeMsciWorld", label: "MSCI World", color: "#9333ea" }] : []),
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
      if (!c) return { label: "—", color: "#f3f4f6", title: "ventana cruza fin de año — excluida" };
      return {
        label: c.rho === null ? "n/d" : c.rho.toFixed(2),
        color: c.rho === null ? "#f3f4f6" : divergingColor(c.rho, 0.5),
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
