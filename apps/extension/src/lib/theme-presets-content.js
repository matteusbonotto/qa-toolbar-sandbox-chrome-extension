// Shared by toolbar.js (applies the tokens live on the page) and options.js (renders the picker
// grid) so the 24 presets only exist in one place. 12 color families x light/dark
// (docs/prompt-mestre-claude-code-qa-toolbar-sandbox(5).md #5.42). Each preset only carries the
// "brand" tokens (primary/highlight) -- base surface/border/text tokens keep following the
// existing light/dark appearanceTheme toggle, so picking a preset also flips appearanceTheme to
// match its own mode. Success/warning/danger/info stay constant per mode across families on
// purpose: they're status colors (Pass/Fail, toast tone), not brand identity, and mixing them with
// 12 different hues would hurt recognizability.
window.QTS_THEME_PRESETS = (() => {
  const presets = Object.freeze([
    { id: "white-light", family: "white", mode: "light", primary: "#64748b", primaryContrast: "#fff" },
    { id: "white-dark", family: "white", mode: "dark", primary: "#cbd5e1", primaryContrast: "#111" },
    { id: "black-light", family: "black", mode: "light", primary: "#27272a", primaryContrast: "#fff" },
    { id: "black-dark", family: "black", mode: "dark", primary: "#71717a", primaryContrast: "#fff" },
    { id: "gray-light", family: "gray", mode: "light", primary: "#6b7280", primaryContrast: "#fff" },
    { id: "gray-dark", family: "gray", mode: "dark", primary: "#9ca3af", primaryContrast: "#111" },
    { id: "red-light", family: "red", mode: "light", primary: "#dc2626", primaryContrast: "#fff" },
    { id: "red-dark", family: "red", mode: "dark", primary: "#ef4444", primaryContrast: "#111" },
    { id: "gold-light", family: "gold", mode: "light", primary: "#b45309", primaryContrast: "#fff" },
    { id: "gold-dark", family: "gold", mode: "dark", primary: "#d97706", primaryContrast: "#111" },
    { id: "blue-light", family: "blue", mode: "light", primary: "#2563eb", primaryContrast: "#fff" },
    { id: "blue-dark", family: "blue", mode: "dark", primary: "#3b82f6", primaryContrast: "#111" },
    { id: "cyan-light", family: "cyan", mode: "light", primary: "#0891b2", primaryContrast: "#fff" },
    { id: "cyan-dark", family: "cyan", mode: "dark", primary: "#22d3ee", primaryContrast: "#111" },
    { id: "pink-light", family: "pink", mode: "light", primary: "#db2777", primaryContrast: "#fff" },
    { id: "pink-dark", family: "pink", mode: "dark", primary: "#f472b6", primaryContrast: "#111" },
    { id: "green-light", family: "green", mode: "light", primary: "#16a34a", primaryContrast: "#fff" },
    { id: "green-dark", family: "green", mode: "dark", primary: "#22c55e", primaryContrast: "#111" },
    { id: "orange-light", family: "orange", mode: "light", primary: "#ea580c", primaryContrast: "#fff" },
    { id: "orange-dark", family: "orange", mode: "dark", primary: "#fb923c", primaryContrast: "#111" },
    { id: "beige-light", family: "beige", mode: "light", primary: "#a8895f", primaryContrast: "#111" },
    { id: "beige-dark", family: "beige", mode: "dark", primary: "#c9a876", primaryContrast: "#111" },
    { id: "brown-light", family: "brown", mode: "light", primary: "#7c4a2d", primaryContrast: "#fff" },
    { id: "brown-dark", family: "brown", mode: "dark", primary: "#a9714a", primaryContrast: "#111" },
  ]);
  const semantics = Object.freeze({
    light: Object.freeze({ secondary: "#475569", success: "#15803d", warning: "#b45309", danger: "#b91c1c", info: "#1d4ed8" }),
    dark: Object.freeze({ secondary: "#94a3b8", success: "#4ade80", warning: "#fbbf24", danger: "#f87171", info: "#60a5fa" }),
  });
  const families = Object.freeze(["white", "black", "gray", "red", "gold", "blue", "cyan", "pink", "green", "orange", "beige", "brown"]);
  return { presets, semantics, families };
})();
