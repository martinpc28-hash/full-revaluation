import { colors } from "./theme.js";

// Two cumulative-return curves (strategy vs. benchmark) over years. Plain
// SVG, no charting library — consistent with the rest of this app's charts.
export default function LineChart({ points, series, xKey = "year" }) {
  const width = 640;
  const height = 240;
  const padding = { top: 16, right: 16, bottom: 28, left: 56 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  if (!points || points.length === 0) {
    return <div style={{ color: colors.textMuted, fontSize: 13 }}>Sin datos suficientes.</div>;
  }

  const xs = points.map((p) => p[xKey]);
  const allYs = points.flatMap((p) => series.map((s) => p[s.key]));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...allYs, 0);
  const yMax = Math.max(...allYs, 0);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const sx = (v) => padding.left + ((v - xMin) / xRange) * plotWidth;
  const sy = (v) => padding.top + plotHeight - ((v - yMin) / yRange) * plotHeight;
  const zeroY = yMin <= 0 && yMax >= 0 ? sy(0) : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
      {zeroY !== null && (
        <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke={colors.border} strokeDasharray="3 3" />
      )}
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke={colors.text} />
      <line
        x1={padding.left}
        y1={height - padding.bottom}
        x2={width - padding.right}
        y2={height - padding.bottom}
        stroke={colors.text}
      />

      {series.map((s) => {
        const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p[xKey])} ${sy(p[s.key])}`).join(" ");
        return (
          <g key={s.key}>
            <path d={path} fill="none" stroke={s.color} strokeWidth={2} />
            {points.map((p, i) => (
              <circle key={i} cx={sx(p[xKey])} cy={sy(p[s.key])} r={2.5} fill={s.color}>
                <title>
                  {s.label} {p[xKey]}: {(p[s.key] * 100).toFixed(1)}%
                </title>
              </circle>
            ))}
          </g>
        );
      })}

      {/* X axis labels: first, middle, last year */}
      {[points[0], points[Math.floor(points.length / 2)], points[points.length - 1]].map((p, i) => (
        <text key={i} x={sx(p[xKey])} y={height - padding.bottom + 16} fontSize="11" fill={colors.textMuted} textAnchor="middle">
          {p[xKey]}
        </text>
      ))}
      {/* Y axis labels */}
      <text x={padding.left - 6} y={padding.top + 4} fontSize="11" fill={colors.textMuted} textAnchor="end">
        {(yMax * 100).toFixed(0)}%
      </text>
      <text x={padding.left - 6} y={height - padding.bottom} fontSize="11" fill={colors.textMuted} textAnchor="end">
        {(yMin * 100).toFixed(0)}%
      </text>

      {/* Legend */}
      {series.map((s, i) => (
        <g key={s.key} transform={`translate(${padding.left + i * 150}, ${padding.top - 4})`}>
          <rect width={10} height={10} fill={s.color} />
          <text x={14} y={9} fontSize="11" fill={colors.text}>
            {s.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
