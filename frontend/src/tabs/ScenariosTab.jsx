import { useState } from "react";
import { api } from "../api.js";
import { ui, colors } from "../theme.js";

// Illustrative macro-shock presets. Each factor is expressed in the same units
// the engine already uses (rate bp, spot %, vol pts, FX %) so it can be combined
// and fed straight into POST /api/scenarios/custom. Tune these constants if you
// want harsher/softer stories — they're intentionally simple, not calibrated
// to any specific historical episode.
const PRESETS = {
  oil: {
    label: "🛢️ Shock energético — petróleo +100 USD/barril",
    help: "Encarece insumos e inflación: tasas suben, renta variable cae, vol sube, divisas se debilitan vs. USD.",
    rateShockBp: 75,
    spotShockPct: -0.12,
    volShockAbs: 0.06,
    fxShockPct: -0.03,
  },
  recession: {
    label: "📉 Economía en recesión mundial",
    help: "Bancos centrales bajan tasas agresivamente, ventas masivas en renta variable, vol dispara, flight-to-USD.",
    rateShockBp: -150,
    spotShockPct: -0.25,
    volShockAbs: 0.12,
    fxShockPct: -0.08,
  },
};

function sumShocks(rateSliderBp, active) {
  let rateShockBp = rateSliderBp;
  let spotShockPct = 0;
  let volShockAbs = 0;
  let fxShockPct = 0;
  for (const key of active) {
    const p = PRESETS[key];
    rateShockBp += p.rateShockBp;
    spotShockPct += p.spotShockPct;
    volShockAbs += p.volShockAbs;
    fxShockPct += p.fxShockPct;
  }
  return { rateShockBp, spotShockPct, volShockAbs, fxShockPct };
}

export default function ScenariosTab({ portfolioId, setStatus, onRunComplete }) {
  const [scenarioSetId, setScenarioSetId] = useState("hist-250d");
  const [scenarioCount, setScenarioCount] = useState("250");
  const [confidence, setConfidence] = useState("0.99");
  const [mcLoading, setMcLoading] = useState(false);
  const [mcGenerated, setMcGenerated] = useState(false);
  const [mcSource, setMcSource] = useState(null); // "real" | "synthetic" | null
  const [genLoading, setGenLoading] = useState(null); // "real" | "synthetic" | null

  const [rateSliderBp, setRateSliderBp] = useState(0);
  const [activePresets, setActivePresets] = useState([]);
  const [stressLoading, setStressLoading] = useState(false);

  const combined = sumShocks(Number(rateSliderBp) || 0, activePresets);

  function togglePreset(key) {
    setActivePresets((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function generateHistorical() {
    setGenLoading("real");
    setStatus(null);
    try {
      const scenarios = await api.generateHistoricalScenarios(scenarioSetId, scenarioCount);
      setMcGenerated(true);
      setMcSource("real");
      const first = scenarios[0]?.scenarioDate;
      const last = scenarios[scenarios.length - 1]?.scenarioDate;
      setStatus({
        type: "success",
        text: `Se cargaron ${scenarios.length} días reales de mercado (${first} a ${last}) desde FRED.`,
      });
    } catch (e) {
      setStatus({ type: "error", text: `No se pudo traer datos reales de FRED: ${e.message}` });
    } finally {
      setGenLoading(null);
    }
  }

  async function generateSynthetic() {
    setGenLoading("synthetic");
    setStatus(null);
    try {
      await api.generateScenarios(scenarioSetId, scenarioCount);
      setMcGenerated(true);
      setMcSource("synthetic");
      setStatus({
        type: "success",
        text: `Se generaron ${scenarioCount} escenarios SINTÉTICOS (ruido aleatorio, no datos reales) para "${scenarioSetId}".`,
      });
    } catch (e) {
      setStatus({ type: "error", text: `No se pudieron generar escenarios: ${e.message}` });
    } finally {
      setGenLoading(null);
    }
  }

  async function runMonteCarlo() {
    setMcLoading(true);
    setStatus(null);
    try {
      const run = await api.runRevaluation(portfolioId, scenarioSetId);
      const [varResult, pnlRows] = await Promise.all([
        api.getVar(run.runId, confidence),
        api.getPnlDistribution(run.runId),
      ]);
      onRunComplete({
        type: "montecarlo",
        runId: run.runId,
        source: mcSource,
        label:
          mcSource === "real"
            ? `VaR con datos históricos reales — FRED (${scenarioSetId})`
            : `VaR con escenarios sintéticos — ruido aleatorio (${scenarioSetId})`,
        varResult,
        pnlRows,
      });
      setStatus({ type: "success", text: "Modelo corrido. Revisa la pestaña de Gráficos y Métricas." });
    } catch (e) {
      setStatus({ type: "error", text: `Falló la corrida: ${e.message}` });
    } finally {
      setMcLoading(false);
    }
  }

  async function runStressTest() {
    setStressLoading(true);
    setStatus(null);
    try {
      const scenario = await api.createCustomScenario({
        scenarioSetId: `stress-${Date.now()}`,
        rateShockBp: combined.rateShockBp,
        spotShockPct: combined.spotShockPct,
        volShockAbs: combined.volShockAbs,
        fxShockPct: combined.fxShockPct,
      });
      const run = await api.runRevaluation(portfolioId, scenario.scenarioSetId);
      const breakdownRows = await api.getInstrumentBreakdown(run.runId);
      const totalPnl = breakdownRows.reduce((sum, r) => sum + Number(r.pnl), 0);
      const labelParts = activePresets.map((k) => PRESETS[k].label);
      if (rateSliderBp) labelParts.push(`${rateSliderBp > 0 ? "+" : ""}${rateSliderBp}pb manual`);
      onRunComplete({
        type: "stress",
        runId: run.runId,
        label: labelParts.length ? labelParts.join(" + ") : "Escenario de estrés personalizado",
        combined,
        breakdownRows,
        totalPnl,
      });
      setStatus({ type: "success", text: "Modelo de estrés corrido. Revisa la pestaña de Gráficos y Métricas." });
    } catch (e) {
      setStatus({ type: "error", text: `Falló la corrida de estrés: ${e.message}` });
    } finally {
      setStressLoading(false);
    }
  }

  return (
    <div>
      <div style={ui.card}>
        <h2 style={ui.cardTitle}>🎲 Escenarios para VaR</h2>
        <p style={ui.cardSubtitle}>
          Genera N escenarios y corre la revaluación completa para obtener el VaR de la cartera. Dos fuentes
          posibles — usa la real siempre que puedas.
        </p>
        <div style={ui.row}>
          <label style={ui.label}>
            ID del set de escenarios
            <input style={ui.input} value={scenarioSetId} onChange={(e) => setScenarioSetId(e.target.value)} />
          </label>
          <label style={ui.label}>
            Cantidad de escenarios (días)
            <input
              style={ui.input}
              type="number"
              value={scenarioCount}
              onChange={(e) => setScenarioCount(e.target.value)}
            />
          </label>
          <label style={ui.label}>
            Confianza del VaR
            <input style={ui.input} value={confidence} onChange={(e) => setConfidence(e.target.value)} />
          </label>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
          <div
            style={{
              flex: 1,
              minWidth: 260,
              padding: 12,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              background: colors.successSoft,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>✅ Datos reales (recomendado)</div>
            <div style={{ fontSize: 12.5, color: colors.textMuted, margin: "4px 0 10px" }}>
              Movimientos diarios reales: tasa del Tesoro a 10 años, S&amp;P 500, VIX y USD/EUR — vía FRED (Reserva
              Federal), gratis, sin API key.
            </div>
            <button style={ui.button("primary")} onClick={generateHistorical} disabled={genLoading !== null}>
              {genLoading === "real" ? "Trayendo datos…" : "1. Generar desde FRED"}
            </button>
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 260,
              padding: 12,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              background: colors.surfaceAlt,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>⚠️ Sintético (respaldo)</div>
            <div style={{ fontSize: 12.5, color: colors.textMuted, margin: "4px 0 10px" }}>
              Ruido aleatorio inventado — no son datos de mercado reales. Solo útil si no hay internet o quieres una
              prueba rápida.
            </div>
            <button style={ui.button("secondary")} onClick={generateSynthetic} disabled={genLoading !== null}>
              {genLoading === "synthetic" ? "Generando…" : "1. Generar sintético"}
            </button>
          </div>
        </div>

        <button
          style={{ ...ui.button("primary"), marginTop: 14 }}
          onClick={runMonteCarlo}
          disabled={mcLoading || !mcGenerated}
        >
          {mcLoading ? "Corriendo…" : "🚀 2. Correr modelo VaR"}
        </button>
        {!mcGenerated && <p style={{ ...ui.muted, marginTop: 8 }}>Genera los escenarios primero para poder correr.</p>}
        {mcGenerated && (
          <p style={{ ...ui.muted, marginTop: 8 }}>
            Fuente activa: {mcSource === "real" ? "✅ datos reales (FRED)" : "⚠️ sintético (aleatorio)"}
          </p>
        )}
      </div>

      <div style={ui.card}>
        <h2 style={ui.cardTitle}>⚡ Variables macro / escenario de estrés</h2>
        <p style={ui.cardSubtitle}>
          Define un shock determinístico (no aleatorio) y corre la revaluación completa bajo ese único escenario —
          útil para responder "¿cuánto perdemos si pasa X?".
        </p>

        <div style={ui.row}>
          <label style={{ ...ui.label, minWidth: 320, flex: 1 }}>
            Aumento de tasas (pbs): <strong>{rateSliderBp > 0 ? "+" : ""}{rateSliderBp}</strong>
            <input
              type="range"
              min={-300}
              max={300}
              step={5}
              value={rateSliderBp}
              onChange={(e) => setRateSliderBp(Number(e.target.value))}
              style={{ marginTop: 6 }}
            />
          </label>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {Object.entries(PRESETS).map(([key, preset]) => (
            <label
              key={key}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                padding: 12,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                background: activePresets.includes(key) ? colors.primarySoft : colors.surfaceAlt,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={activePresets.includes(key)}
                onChange={() => togglePreset(key)}
                style={{ marginTop: 3 }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{preset.label}</div>
                <div style={{ fontSize: 12.5, color: colors.textMuted, marginTop: 2 }}>{preset.help}</div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ ...ui.statGrid, marginTop: 16 }}>
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
            <div style={ui.statLabel}>Shock de vol</div>
            <div style={ui.statValue}>{(combined.volShockAbs * 100).toFixed(1)}pt</div>
          </div>
          <div style={ui.statCard}>
            <div style={ui.statLabel}>Shock FX (vs. USD)</div>
            <div style={ui.statValue}>{(combined.fxShockPct * 100).toFixed(1)}%</div>
          </div>
        </div>

        <button
          style={{ ...ui.button("primary"), marginTop: 16, background: colors.danger }}
          onClick={runStressTest}
          disabled={stressLoading}
        >
          {stressLoading ? "Corriendo…" : "🚀 Correr modelo de estrés"}
        </button>
      </div>
    </div>
  );
}
