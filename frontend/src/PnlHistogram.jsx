import { colors } from "./theme.js";

// Lightweight dependency-free histogram: buckets P&L values into N bins
// and renders them as an SVG bar chart. No charting library needed.
export default function PnlHistogram({ pnlValues, bins = 20 }) {
  if (!pnlValues || pnlValues.length === 0) return null;

  const min = Math.min(...pnlValues);
  const max = Math.max(...pnlValues);
  const width = 640;
  const height = 220;
  const padding = { top: 10, right: 10, bottom: 24, left: 10 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Degenerate case: all values identical.
  const range = max - min || 1;
  const binWidth = range / bins;
  const counts = new Array(bins).fill(0);
  for (const v of pnlValues) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);
  const barGap = 2;
  const barWidth = plotWidth / bins - barGap;

  // Zero P&L reference line, if within range.
  const zeroX = min <= 0 && max >= 0 ? padding.left + ((0 - min) / range) * plotWidth : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
      {counts.map((c, i) => {
        const barHeight = maxCount > 0 ? (c / maxCount) * plotHeight : 0;
        const x = padding.left + i * (plotWidth / bins) + barGap / 2;
        const y = padding.top + (plotHeight - barHeight);
        const binStart = min + i * binWidth;
        const isLoss = binStart < 0;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={Math.max(barWidth, 1)}
            height={barHeight}
            fill={isLoss ? colors.danger : colors.primary}
            opacity={0.85}
          >
            <title>
              {binStart.toLocaleString(undefined, { maximumFractionDigits: 0 })} to{" "}
              {(binStart + binWidth).toLocaleString(undefined, { maximumFractionDigits: 0 })}: {c} scenario(s)
            </title>
          </rect>
        );
      })}
      {zeroX !== null && (
        <line
          x1={zeroX}
          y1={padding.top}
          x2={zeroX}
          y2={padding.top + plotHeight}
          stroke={colors.text}
          strokeDasharray="4 3"
          strokeWidth={1}
        />
      )}
      <text x={padding.left} y={height - 6} fontSize="11" fill="#666">
        {min.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </text>
      <text x={width - padding.right} y={height - 6} fontSize="11" fill="#666" textAnchor="end">
        {max.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </text>
    </svg>
  );
}
