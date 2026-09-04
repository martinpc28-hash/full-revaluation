import PnlHistogram from "../PnlHistogram.jsx";
import InstrumentBarChart from "../InstrumentBarChart.jsx";
import { ui, colors } from "../theme.js";

export default function DashboardTab({ lastRun, portfolioName, onGoToScenarios }) {
  if (!lastRun) {
    return (
      <div style={ui.card}>
        <div style={ui.emptyState}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <p style={{ margin: "0 0 12px 0" }}>
            Todavía no has corrido ningún modelo para <strong>{portfolioName}</strong>.
          </p>
          <button style={ui.button("primary")} onClick={onGoToScenarios}>
            ⚙️ Ir a Escenarios
          </button>
        </div>
      </div>
    );
  }

  if (lastRun.type === "montecarlo") {
    const pnlValues = lastRun.pnlRows.map((r) => Number(r.pnl));
    return (
      <div>
        <div style={ui.card}>
          <span style={ui.badge(lastRun.source === "real" ? "success" : "warning")}>
            {lastRun.source === "real" ? "✅ Datos reales (FRED)" : "⚠️ Sintético (aleatorio)"}
          </span>
          <h2 style={{ ...ui.cardTitle, marginTop: 8 }}>{lastRun.label}</h2>
          {lastRun.source !== "real" && (
            <p style={{ ...ui.muted, color: colors.warning }}>
              Este VaR viene de ruido aleatorio inventado, no de movimientos de mercado reales — trátalo como una
              prueba del pipeline, no como un número confiable.
            </p>
          )}
          <div style={ui.statGrid}>
            <div style={ui.statCard}>
              <div style={ui.statLabel}>{Number(lastRun.varResult.confidence) * 100}% VaR (USD)</div>
              <div style={{ ...ui.statValue, color: colors.danger }}>
                {Number(lastRun.varResult.var).toLocaleString()}
              </div>
            </div>
            <div style={ui.statCard}>
              <div style={ui.statLabel}>Escenarios simulados</div>
              <div style={ui.statValue}>{pnlValues.length}</div>
            </div>
            <div style={ui.statCard}>
              <div style={ui.statLabel}>Peor escenario</div>
              <div style={{ ...ui.statValue, color: colors.danger }}>
                {Math.min(...pnlValues).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
            <div style={ui.statCard}>
              <div style={ui.statLabel}>Mejor escenario</div>
              <div style={{ ...ui.statValue, color: colors.success }}>
                {Math.max(...pnlValues).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>
        </div>

        <div style={ui.card}>
          <h3 style={ui.cardTitle}>Distribución de P&amp;L</h3>
          <PnlHistogram pnlValues={pnlValues} />
          <p style={ui.muted}>Barras rojas = escenarios de pérdida. Línea punteada = punto de equilibrio.</p>
        </div>

        <div style={ui.card}>
          <h3 style={ui.cardTitle}>Resultados por escenario (peor primero)</h3>
          <div style={{ ...ui.tableScroll, maxHeight: 340, overflowY: "auto" }}>
            <table style={ui.table}>
              <thead>
                <tr>
                  <th style={ui.th}>Escenario</th>
                  <th style={ui.th}>Fecha</th>
                  <th style={ui.th}>Shock tasa (pb)</th>
                  <th style={ui.th}>Shock spot</th>
                  <th style={ui.th}>Shock vol</th>
                  <th style={ui.th}>Shock FX</th>
                  <th style={ui.th}>P&amp;L cartera</th>
                </tr>
              </thead>
              <tbody>
                {lastRun.pnlRows.map((r) => (
                  <tr key={r.scenarioId}>
                    <td style={ui.td}>{r.scenarioId}</td>
                    <td style={ui.td}>{r.scenarioDate || "—"}</td>
                    <td style={ui.td}>{Number(r.rateShockBp).toFixed(2)}</td>
                    <td style={ui.td}>{(Number(r.spotShockPct) * 100).toFixed(2)}%</td>
                    <td style={ui.td}>{(Number(r.volShockAbs) * 100).toFixed(2)}pt</td>
                    <td style={ui.td}>{(Number(r.fxShockPct) * 100).toFixed(2)}%</td>
                    <td style={{ ...ui.td, color: Number(r.pnl) < 0 ? colors.danger : colors.success, fontWeight: 700 }}>
                      {Number(r.pnl).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Stress test
  const { combined, breakdownRows, totalPnl } = lastRun;
  const worst = breakdownRows[0];
  return (
    <div>
      <div style={ui.card}>
        <span style={ui.badge("danger")}>Escenario de estrés</span>
        <h2 style={{ ...ui.cardTitle, marginTop: 8 }}>{lastRun.label}</h2>
        <div style={ui.statGrid}>
          <div style={ui.statCard}>
            <div style={ui.statLabel}>Impacto total en cartera</div>
            <div style={{ ...ui.statValue, color: totalPnl < 0 ? colors.danger : colors.success }}>
              {totalPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div style={ui.statCard}>
            <div style={ui.statLabel}>Shock de tasas</div>
            <div style={ui.statValue}>
              {combined.rateShockBp > 0 ? "+" : ""}
              {combined.rateShockBp.toFixed(0)} pb
            </div>
          </div>
          <div style={ui.statCard}>
            <div style={ui.statLabel}>Shock de spot</div>
            <div style={ui.statValue}>{(combined.spotShockPct * 100).toFixed(1)}%</div>
          </div>
          <div style={ui.statCard}>
            <div style={ui.statLabel}>Posición más afectada</div>
            <div style={{ ...ui.statValue, fontSize: 16 }}>{worst ? worst.name : "—"}</div>
          </div>
        </div>
      </div>

      <div style={ui.card}>
        <h3 style={ui.cardTitle}>Impacto por instrumento</h3>
        <InstrumentBarChart rows={breakdownRows} />
      </div>

      <div style={ui.card}>
        <h3 style={ui.cardTitle}>Detalle por instrumento</h3>
        <div style={ui.tableScroll}>
          <table style={ui.table}>
            <thead>
              <tr>
                <th style={ui.th}>Instrumento</th>
                <th style={ui.th}>Tipo</th>
                <th style={ui.th}>Valor base</th>
                <th style={ui.th}>P&amp;L bajo el shock</th>
              </tr>
            </thead>
            <tbody>
              {breakdownRows.map((r) => (
                <tr key={r.instrumentId}>
                  <td style={ui.td}>{r.name}</td>
                  <td style={ui.td}>
                    <span style={ui.badge("neutral")}>{r.type}</span>
                  </td>
                  <td style={ui.td}>{Number(r.baseValue).toLocaleString()}</td>
                  <td style={{ ...ui.td, color: Number(r.pnl) < 0 ? colors.danger : colors.success, fontWeight: 700 }}>
                    {Number(r.pnl).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
