// Generic heatmap/grid: row labels x column labels, one colored+labeled cell
// per pair. Used for the coverage strip, the year x asset ranking heatmap,
// and the window-sweep matrix — each just supplies differently-colored cells.
// Plain HTML table (not SVG): text-heavy grids with many small cells are
// simpler this way, and it scrolls horizontally for free inside ui.tableScroll.
export default function HeatmapGrid({ rowLabels, colLabels, cells, rowLabelWidth = 110, cellWidth = 46, cellHeight = 26 }) {
  return (
    <table style={{ borderCollapse: "collapse", fontSize: 11.5 }}>
      <thead>
        <tr>
          <th style={{ width: rowLabelWidth, minWidth: rowLabelWidth }} />
          {colLabels.map((c, i) => (
            <th
              key={i}
              style={{
                width: cellWidth,
                minWidth: cellWidth,
                padding: "2px 4px",
                fontWeight: 600,
                color: "#6b7280",
                whiteSpace: "nowrap",
              }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowLabels.map((row, rIdx) => (
          <tr key={rIdx}>
            <td
              style={{
                width: rowLabelWidth,
                minWidth: rowLabelWidth,
                padding: "2px 6px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {row}
            </td>
            {colLabels.map((_, cIdx) => {
              const cell = cells[rIdx]?.[cIdx] ?? { label: "", color: "#f3f4f6" };
              return (
                <td
                  key={cIdx}
                  title={cell.title || ""}
                  style={{
                    width: cellWidth,
                    height: cellHeight,
                    minWidth: cellWidth,
                    textAlign: "center",
                    background: cell.color,
                    color: cell.textColor || "#1a1f2b",
                    border: "1px solid #fff",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {cell.label}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Diverging red-white-green scale for values roughly in [-1, 1] (e.g. Spearman rho, returns as fractions). */
export function divergingColor(value, maxAbs = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "#f3f4f6";
  const t = Math.max(-1, Math.min(1, value / maxAbs));
  if (t >= 0) {
    // white -> green
    const g = Math.round(247 - t * (247 - 34));
    const r = Math.round(247 - t * (247 - 120));
    return `rgb(${r},${Math.round(247 - t * (247 - 197))},${g})`;
  }
  // white -> red
  const s = -t;
  const g = Math.round(247 - s * (247 - 72));
  const b = Math.round(247 - s * (247 - 63));
  return `rgb(${Math.round(247 - s * (247 - 214))},${g},${b})`;
}
