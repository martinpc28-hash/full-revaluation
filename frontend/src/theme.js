// Shared design tokens + reusable style objects, used across the whole app
// so all three tabs (and the shell) look like one cohesive product instead
// of three separate forms glued together.

export const colors = {
  bg: "#2b2f38",
  surface: "#373c47",
  surfaceAlt: "#444a57",
  border: "#565c6c",
  text: "#f0f1f5",
  textMuted: "#b0b6c4",
  primary: "#6b98f2",
  primaryDark: "#a6c3f8",
  primarySoft: "#3a4868",
  danger: "#f47b70",
  dangerSoft: "#4f3236",
  success: "#4fdb8e",
  successSoft: "#2c4a3c",
  warning: "#eab157",
  warningSoft: "#4f4026",
};

export const shell = {
  app: {
    minHeight: "100vh",
    background: colors.bg,
    color: colors.text,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
    padding: "16px 24px",
    background: colors.surface,
    borderBottom: `1px solid ${colors.border}`,
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  brand: { display: "flex", alignItems: "center", gap: 10 },
  brandTitle: { fontSize: 18, fontWeight: 700, margin: 0 },
  brandSubtitle: { fontSize: 12, color: colors.textMuted, margin: 0 },
  tabBar: {
    display: "flex",
    gap: 4,
    padding: "0 24px",
    background: colors.surface,
    borderBottom: `1px solid ${colors.border}`,
    overflowX: "auto",
  },
  tabButton: (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 18px",
    fontSize: 14,
    fontWeight: active ? 600 : 500,
    color: active ? colors.primary : colors.textMuted,
    background: "transparent",
    border: "none",
    borderBottom: active ? `2px solid ${colors.primary}` : "2px solid transparent",
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),
  main: { maxWidth: 980, margin: "0 auto", padding: "24px" },
};

export const ui = {
  card: {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    boxShadow: "0 1px 2px rgba(20,24,40,0.04)",
  },
  cardTitle: { margin: "0 0 4px 0", fontSize: 16, fontWeight: 700 },
  cardSubtitle: { margin: "0 0 16px 0", fontSize: 13, color: colors.textMuted },
  form: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" },
  row: { display: "flex", flexWrap: "wrap", gap: 12 },
  label: { display: "flex", flexDirection: "column", fontSize: 13, color: colors.textMuted, minWidth: 140, gap: 4 },
  input: {
    padding: "8px 10px",
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    fontSize: 14,
    background: colors.surface,
    color: colors.text,
  },
  button: (variant = "primary") => {
    const base = {
      padding: "9px 16px",
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 14,
      fontWeight: 600,
      border: "1px solid transparent",
      height: 38,
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
    };
    if (variant === "primary") return { ...base, background: colors.primary, color: "#fff" };
    if (variant === "secondary")
      return { ...base, background: colors.surface, color: colors.text, border: `1px solid ${colors.border}` };
    if (variant === "danger") return { ...base, background: colors.dangerSoft, color: colors.danger };
    if (variant === "ghost") return { ...base, background: "transparent", color: colors.textMuted, border: "none" };
    return base;
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    borderBottom: `2px solid ${colors.border}`,
    padding: "8px 10px",
    fontSize: 12,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
  },
  td: { borderBottom: `1px solid ${colors.border}`, padding: "8px 10px", fontSize: 13.5, whiteSpace: "nowrap" },
  tableScroll: { overflowX: "auto" },
  muted: { color: colors.textMuted, fontSize: 13 },
  badge: (tone = "neutral") => {
    const tones = {
      neutral: { bg: colors.surfaceAlt, fg: colors.textMuted },
      primary: { bg: colors.primarySoft, fg: colors.primaryDark },
      success: { bg: colors.successSoft, fg: colors.success },
      danger: { bg: colors.dangerSoft, fg: colors.danger },
      warning: { bg: colors.warningSoft, fg: colors.warning },
    };
    const t = tones[tone] || tones.neutral;
    return {
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: 11.5,
      fontWeight: 700,
      background: t.bg,
      color: t.fg,
      textTransform: "uppercase",
      letterSpacing: 0.3,
    };
  },
  bannerError: {
    background: colors.dangerSoft,
    color: colors.danger,
    border: `1px solid #7a4640`,
    borderRadius: 8,
    padding: "10px 14px",
    marginBottom: 16,
    fontSize: 14,
  },
  bannerSuccess: {
    background: colors.successSoft,
    color: colors.success,
    border: `1px solid #3d6b50`,
    borderRadius: 8,
    padding: "10px 14px",
    marginBottom: 16,
    fontSize: 14,
  },
  emptyState: {
    textAlign: "center",
    padding: "32px 16px",
    color: colors.textMuted,
    fontSize: 14,
  },
  statGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 },
  statCard: {
    background: colors.surfaceAlt,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: 16,
  },
  statLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 },
  statValue: { fontSize: 22, fontWeight: 700 },
};
