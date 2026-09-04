import { colors } from "./theme.js";

// Horizontal bar chart: one bar per instrument, showing its P&L under a
// (typically single-scenario) stress run. No charting library — plain SVG.
export default function InstrumentBarChart({ rows }) {
  if (!rows || rows.length === 0) return null;

  const width = 640;
  const rowHeight = 34;
  const labelWidth = 160;
  const height = rows.length * rowHeight + 20;
  const plotWidth = width - labelWidth - 80;

  const maxAbs = Math.max(...rows.map((r) => Math.abs(Number(r.pnl))), 1);
  const centerX = labelWidth + plotWidth / 2;
  const scale = (plotWidth / 2) / maxAbs;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
      <line x1={centerX} y1={0} x2={centerX} y2={height - 10} stroke={colors.border} strokeWidth={1} />
      {rows.map((r, i) => {
        const pnl = Number(r.pnl);
        const barW = Math.abs(pnl) * scale;
        const isLoss = pnl < 0;
        const x = isLoss ? centerX - barW : centerX;
        const y = i * rowHeight + 6;
        return (
          <g key={r.instrumentId}>
            <text x={labelWidth - 10} y={y + 15} fontSize="12" fill={colors.text} textAnchor="end">
              {r.name.length > 18 ? r.name.slice(0, 17) + "…" : r.name}
            </text>
            <rect
              x={x}
              y={y}
              width={Math.max(barW, 1)}
              height={20}
              fill={isLoss ? colors.danger : colors.success}
              opacity={0.85}
              rx={3}
            >
              <title>
                {r.name}: {pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </title>
            </rect>
            <text
              x={isLoss ? x - 6 : x + barW + 6}
              y={y + 15}
              fontSize="12"
              fill={colors.textMuted}
              textAnchor={isLoss ? "end" : "start"}
            >
              {pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
