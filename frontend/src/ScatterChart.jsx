import { colors } from "./theme.js";

// Scatter plot of signal-window return (x) vs. a comparison-window return (y),
// one point per (ticker, year), with the pooled Spearman rho / p-value / n
// annotated in the corner. Plain SVG, no charting library.
export default function ScatterChart({ points, rho, pValue, n, xLabel, yLabel }) {
  const width = 420;
  const height = 300;
  const padding = { top: 16, right: 16, bottom: 40, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  if (!points || points.length === 0) {
    return <div style={{ color: colors.textMuted, fontSize: 13 }}>Sin datos suficientes.</div>;
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs, 0);
  const xMax = Math.max(...xs, 0);
  const yMin = Math.min(...ys, 0);
  const yMax = Math.max(...ys, 0);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const sx = (v) => padding.left + ((v - xMin) / xRange) * plotWidth;
  const sy = (v) => padding.top + plotHeight - ((v - yMin) / yRange) * plotHeight;

  const zeroX = xMin <= 0 && xMax >= 0 ? sx(0) : null;
  const zeroY = yMin <= 0 && yMax >= 0 ? sy(0) : null;

  const rhoText = rho === null || rho === undefined ? "n/d" : rho.toFixed(3);
  const pText = pValue === null || pValue === undefined ? "n/d" : pValue < 0.001 ? "<0.001" : pValue.toFixed(3);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
      {zeroY !== null && (
        <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke={colors.border} strokeDasharray="3 3" />
      )}
      {zeroX !== null && (
        <line x1={zeroX} y1={padding.top} x2={zeroX} y2={height - padding.bottom} stroke={colors.border} strokeDasharray="3 3" />
      )}

      {points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={3.5} fill={colors.primary} opacity={0.65}>
          <title>{p.label ? `${p.label}: (${(p.x * 100).toFixed(1)}%, ${(p.y * 100).toFixed(1)}%)` : ""}</title>
        </circle>
      ))}

      {/* Axes */}
      <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke={colors.text} />
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke={colors.text} />
      <text x={width / 2} y={height - 6} fontSize="11" fill={colors.textMuted} textAnchor="middle">
        {xLabel}
      </text>
      <text x={12} y={height / 2} fontSize="11" fill={colors.textMuted} textAnchor="middle" transform={`rotate(-90, 12, ${height / 2})`}>
        {yLabel}
      </text>

      {/* Annotation */}
      <rect x={width - 148} y={padding.top} width={136} height={44} fill="#fff" opacity={0.85} stroke={colors.border} rx={4} />
      <text x={width - 140} y={padding.top + 16} fontSize="11.5" fontWeight="700" fill={colors.text}>
        ρ = {rhoText}
      </text>
      <text x={width - 140} y={padding.top + 30} fontSize="11" fill={colors.textMuted}>
        p = {pText}, n = {n}
      </text>
    </svg>
  );
}
