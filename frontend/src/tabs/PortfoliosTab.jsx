import { useState } from "react";
import { api } from "../api.js";
import { ui, colors } from "../theme.js";

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "MXN", "COP"];

const emptyBond = {
  name: "",
  notional: "1000000",
  couponRate: "0.035",
  yearsToMaturity: "10",
  baseYield: "0.04",
  currency: "USD",
  baseFxRate: "1",
};

const emptyOption = {
  name: "",
  notional: "1000000",
  optionType: "CALL",
  strike: "100",
  baseSpot: "100",
  baseVol: "0.2",
  riskFreeRate: "0.03",
  yearsToExpiry: "1",
  currency: "USD",
  baseFxRate: "1",
};

const emptyEquity = {
  name: "",
  shares: "1000",
  baseSpot: "100",
  currency: "USD",
  baseFxRate: "1",
};

function CurrencyFields({ value, onChange }) {
  return (
    <>
      <label style={ui.label}>
        Divisa
        <select style={ui.input} value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {value.currency !== "USD" && (
        <label style={ui.label}>
          Tasa FX a USD (t0)
          <input
            style={ui.input}
            type="number"
            step="0.0001"
            value={value.baseFxRate}
            onChange={(e) => onChange({ ...value, baseFxRate: e.target.value })}
          />
        </label>
      )}
    </>
  );
}

function instrumentType(ins) {
  if (ins.optionType) return "OPTION";
  if (ins.shares !== undefined && ins.shares !== null) return "EQUITY";
  return "BOND";
}

function instrumentDetails(ins) {
  const type = instrumentType(ins);
  if (type === "OPTION") return `${ins.optionType} strike=${ins.strike} spot=${ins.baseSpot} vol=${ins.baseVol}`;
  if (type === "EQUITY") return `acciones=${ins.shares} spot=${ins.baseSpot}`;
  return `cupón=${ins.couponRate} venc=${ins.yearsToMaturity}a yield=${ins.baseYield}`;
}

const typeBadge = { BOND: "primary", OPTION: "warning", EQUITY: "success" };

export default function PortfoliosTab({
  portfolios,
  currentPortfolioId,
  onSelectPortfolio,
  onCreatePortfolio,
  onDeletePortfolio,
  instruments,
  onInstrumentsChanged,
  setStatus,
}) {
  const [bondForm, setBondForm] = useState(emptyBond);
  const [optionForm, setOptionForm] = useState(emptyOption);
  const [equityForm, setEquityForm] = useState(emptyEquity);
  const [newPortfolioName, setNewPortfolioName] = useState("");

  async function addBond(e) {
    e.preventDefault();
    setStatus(null);
    try {
      await api.addBond(currentPortfolioId, {
        name: bondForm.name || `Bono ${Date.now()}`,
        notional: bondForm.notional,
        couponRate: bondForm.couponRate,
        yearsToMaturity: Number(bondForm.yearsToMaturity),
        baseYield: bondForm.baseYield,
        currency: bondForm.currency,
        baseFxRate: bondForm.baseFxRate,
      });
      setBondForm(emptyBond);
      setStatus({ type: "success", text: "Bono agregado." });
      onInstrumentsChanged();
    } catch (e) {
      setStatus({ type: "error", text: `No se pudo agregar el bono: ${e.message}` });
    }
  }

  async function addOption(e) {
    e.preventDefault();
    setStatus(null);
    try {
      await api.addOption(currentPortfolioId, {
        name: optionForm.name || `Opción ${Date.now()}`,
        notional: optionForm.notional,
        optionType: optionForm.optionType,
        strike: optionForm.strike,
        baseSpot: optionForm.baseSpot,
        baseVol: optionForm.baseVol,
        riskFreeRate: optionForm.riskFreeRate,
        yearsToExpiry: optionForm.yearsToExpiry,
        currency: optionForm.currency,
        baseFxRate: optionForm.baseFxRate,
      });
      setOptionForm(emptyOption);
      setStatus({ type: "success", text: "Opción agregada." });
      onInstrumentsChanged();
    } catch (e) {
      setStatus({ type: "error", text: `No se pudo agregar la opción: ${e.message}` });
    }
  }

  async function addEquity(e) {
    e.preventDefault();
    setStatus(null);
    try {
      await api.addEquity(currentPortfolioId, {
        name: equityForm.name || `Acción ${Date.now()}`,
        shares: equityForm.shares,
        baseSpot: equityForm.baseSpot,
        currency: equityForm.currency,
        baseFxRate: equityForm.baseFxRate,
      });
      setEquityForm(emptyEquity);
      setStatus({ type: "success", text: "Acción agregada." });
      onInstrumentsChanged();
    } catch (e) {
      setStatus({ type: "error", text: `No se pudo agregar la acción: ${e.message}` });
    }
  }

  async function deleteInstrument(instrumentId) {
    setStatus(null);
    try {
      await api.deleteInstrument(currentPortfolioId, instrumentId);
      setStatus({ type: "success", text: "Instrumento eliminado." });
      onInstrumentsChanged();
    } catch (e) {
      setStatus({ type: "error", text: `No se pudo eliminar: ${e.message}` });
    }
  }

  function createPortfolio() {
    const name = newPortfolioName.trim() || `Cartera ${portfolios.length + 1}`;
    onCreatePortfolio(name);
    setNewPortfolioName("");
  }

  return (
    <div>
      <div style={ui.card}>
        <h2 style={ui.cardTitle}>💼 Tus carteras</h2>
        <p style={ui.cardSubtitle}>Crea varias carteras para comparar distintos libros o estrategias.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {portfolios.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectPortfolio(p.id)}
              style={{
                ...ui.button(p.id === currentPortfolioId ? "primary" : "secondary"),
                borderRadius: 999,
                padding: "6px 14px",
                height: "auto",
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div style={ui.row}>
          <label style={ui.label}>
            Nombre de la nueva cartera
            <input
              style={ui.input}
              placeholder="ej. Renta fija LatAm"
              value={newPortfolioName}
              onChange={(e) => setNewPortfolioName(e.target.value)}
            />
          </label>
          <button style={ui.button("secondary")} onClick={createPortfolio}>
            ➕ Crear cartera
          </button>
          {portfolios.length > 1 && (
            <button
              style={ui.button("danger")}
              onClick={() => onDeletePortfolio(currentPortfolioId)}
              title="Elimina esta cartera de la lista (los instrumentos quedan huérfanos en el servidor, no se borran)"
            >
              🗑️ Quitar cartera actual
            </button>
          )}
        </div>
      </div>

      <div style={ui.card}>
        <h2 style={ui.cardTitle}>Agregar un bono</h2>
        <form onSubmit={addBond} style={ui.form}>
          <label style={ui.label}>
            Nombre
            <input
              style={ui.input}
              placeholder="ej. UST 10y"
              value={bondForm.name}
              onChange={(e) => setBondForm({ ...bondForm, name: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Nocional
            <input
              style={ui.input}
              type="number"
              value={bondForm.notional}
              onChange={(e) => setBondForm({ ...bondForm, notional: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Cupón anual (ej. 0.035)
            <input
              style={ui.input}
              type="number"
              step="0.0001"
              value={bondForm.couponRate}
              onChange={(e) => setBondForm({ ...bondForm, couponRate: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Años a vencimiento
            <input
              style={ui.input}
              type="number"
              value={bondForm.yearsToMaturity}
              onChange={(e) => setBondForm({ ...bondForm, yearsToMaturity: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Yield base (ej. 0.04)
            <input
              style={ui.input}
              type="number"
              step="0.0001"
              value={bondForm.baseYield}
              onChange={(e) => setBondForm({ ...bondForm, baseYield: e.target.value })}
            />
          </label>
          <CurrencyFields value={bondForm} onChange={setBondForm} />
          <button style={ui.button("primary")} type="submit">
            Agregar bono
          </button>
        </form>
      </div>

      <div style={ui.card}>
        <h2 style={ui.cardTitle}>Agregar una opción europea</h2>
        <form onSubmit={addOption} style={ui.form}>
          <label style={ui.label}>
            Nombre
            <input
              style={ui.input}
              placeholder="ej. SPX call"
              value={optionForm.name}
              onChange={(e) => setOptionForm({ ...optionForm, name: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Nocional
            <input
              style={ui.input}
              type="number"
              value={optionForm.notional}
              onChange={(e) => setOptionForm({ ...optionForm, notional: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Tipo
            <select
              style={ui.input}
              value={optionForm.optionType}
              onChange={(e) => setOptionForm({ ...optionForm, optionType: e.target.value })}
            >
              <option value="CALL">CALL</option>
              <option value="PUT">PUT</option>
            </select>
          </label>
          <label style={ui.label}>
            Strike
            <input
              style={ui.input}
              type="number"
              value={optionForm.strike}
              onChange={(e) => setOptionForm({ ...optionForm, strike: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Spot base
            <input
              style={ui.input}
              type="number"
              value={optionForm.baseSpot}
              onChange={(e) => setOptionForm({ ...optionForm, baseSpot: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Vol base (ej. 0.20 = 20%)
            <input
              style={ui.input}
              type="number"
              step="0.0001"
              value={optionForm.baseVol}
              onChange={(e) => setOptionForm({ ...optionForm, baseVol: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Tasa libre de riesgo
            <input
              style={ui.input}
              type="number"
              step="0.0001"
              value={optionForm.riskFreeRate}
              onChange={(e) => setOptionForm({ ...optionForm, riskFreeRate: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Años a expiración
            <input
              style={ui.input}
              type="number"
              step="0.01"
              value={optionForm.yearsToExpiry}
              onChange={(e) => setOptionForm({ ...optionForm, yearsToExpiry: e.target.value })}
            />
          </label>
          <CurrencyFields value={optionForm} onChange={setOptionForm} />
          <button style={ui.button("primary")} type="submit">
            Agregar opción
          </button>
        </form>
      </div>

      <div style={ui.card}>
        <h2 style={ui.cardTitle}>Agregar una acción</h2>
        <p style={ui.cardSubtitle}>Revaluación lineal: valor = acciones × spot shockeado.</p>
        <form onSubmit={addEquity} style={ui.form}>
          <label style={ui.label}>
            Nombre
            <input
              style={ui.input}
              placeholder="ej. AAPL"
              value={equityForm.name}
              onChange={(e) => setEquityForm({ ...equityForm, name: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Acciones
            <input
              style={ui.input}
              type="number"
              value={equityForm.shares}
              onChange={(e) => setEquityForm({ ...equityForm, shares: e.target.value })}
            />
          </label>
          <label style={ui.label}>
            Spot base (precio/acción)
            <input
              style={ui.input}
              type="number"
              value={equityForm.baseSpot}
              onChange={(e) => setEquityForm({ ...equityForm, baseSpot: e.target.value })}
            />
          </label>
          <CurrencyFields value={equityForm} onChange={setEquityForm} />
          <button style={ui.button("primary")} type="submit">
            Agregar acción
          </button>
        </form>
      </div>

      <div style={ui.card}>
        <h2 style={ui.cardTitle}>Instrumentos en "{portfolios.find((p) => p.id === currentPortfolioId)?.name}"</h2>
        {instruments.length === 0 ? (
          <div style={ui.emptyState}>Todavía no hay instrumentos — agrega un bono, opción o acción arriba.</div>
        ) : (
          <div style={ui.tableScroll}>
            <table style={ui.table}>
              <thead>
                <tr>
                  <th style={ui.th}>ID</th>
                  <th style={ui.th}>Tipo</th>
                  <th style={ui.th}>Nombre</th>
                  <th style={ui.th}>Divisa</th>
                  <th style={ui.th}>Nocional</th>
                  <th style={ui.th}>Detalle</th>
                  <th style={ui.th}></th>
                </tr>
              </thead>
              <tbody>
                {instruments.map((ins) => {
                  const type = instrumentType(ins);
                  return (
                    <tr key={ins.id}>
                      <td style={ui.td}>{ins.id}</td>
                      <td style={ui.td}>
                        <span style={ui.badge(typeBadge[type])}>{type}</span>
                      </td>
                      <td style={ui.td}>{ins.name}</td>
                      <td style={ui.td}>{ins.currency || "USD"}</td>
                      <td style={ui.td}>{Number(ins.notional).toLocaleString()}</td>
                      <td style={ui.td}>{instrumentDetails(ins)}</td>
                      <td style={ui.td}>
                        <button
                          style={{ ...ui.button("ghost"), color: colors.danger, height: "auto", padding: "2px 6px" }}
                          onClick={() => deleteInstrument(ins.id)}
                          title="Eliminar instrumento"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
