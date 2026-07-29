// Shared by toolbar.js (applies the tokens live on the page) and options.js (renders the picker
// grid) so each color family has one light and one dark variant.
// (docs/prompt-mestre-claude-code-qa-toolbar-sandbox(5).md #5.42). Each preset only carries the
// "brand" tokens (primary/highlight) -- base surface/border/text tokens keep following the
// existing light/dark appearanceTheme toggle, so picking a preset also flips appearanceTheme to
// match its own mode. Success/warning/danger/info stay constant per mode across families on
// purpose: they're status colors (Pass/Fail, toast tone), not brand identity, and mixing them with
// unrelated hues would hurt recognizability.
window.QTS_THEME_PRESETS = (() => {
  const presets = Object.freeze([
    { id: "red-light", family: "red", mode: "light", primary: "#dc2626", primaryContrast: "#fff" },
    { id: "red-dark", family: "red", mode: "dark", primary: "#ef4444", primaryContrast: "#111" },
    { id: "gold-light", family: "gold", mode: "light", primary: "#b45309", primaryContrast: "#fff" },
    { id: "gold-dark", family: "gold", mode: "dark", primary: "#d97706", primaryContrast: "#111" },
    { id: "blue-light", family: "blue", mode: "light", primary: "#2563eb", primaryContrast: "#fff" },
    { id: "blue-dark", family: "blue", mode: "dark", primary: "#3b82f6", primaryContrast: "#111" },
    { id: "pink-light", family: "pink", mode: "light", primary: "#db2777", primaryContrast: "#fff" },
    { id: "pink-dark", family: "pink", mode: "dark", primary: "#f472b6", primaryContrast: "#111" },
    { id: "green-light", family: "green", mode: "light", primary: "#16a34a", primaryContrast: "#fff" },
    { id: "green-dark", family: "green", mode: "dark", primary: "#22c55e", primaryContrast: "#111" },
    { id: "orange-light", family: "orange", mode: "light", primary: "#ea580c", primaryContrast: "#fff" },
    { id: "orange-dark", family: "orange", mode: "dark", primary: "#fb923c", primaryContrast: "#111" },
    { id: "purple-light", family: "purple", mode: "light", primary: "#7c3aed", primaryContrast: "#fff" },
    { id: "purple-dark", family: "purple", mode: "dark", primary: "#a78bfa", primaryContrast: "#111" },
    { id: "yellow-light", family: "yellow", mode: "light", primary: "#ca8a04", primaryContrast: "#111" },
    { id: "yellow-dark", family: "yellow", mode: "dark", primary: "#facc15", primaryContrast: "#111" },
    { id: "lego-light", family: "lego", mode: "light", primary: "#e11d48", primaryContrast: "#fff", secondary: "#7c3aed", success: "#16a34a", warning: "#facc15", danger: "#dc2626", info: "#2563eb" },
    { id: "lego-dark", family: "lego", mode: "dark", primary: "#f43f5e", primaryContrast: "#111", secondary: "#c084fc", success: "#4ade80", warning: "#fde047", danger: "#fb7185", info: "#60a5fa" },
  ]);
  const semantics = Object.freeze({
    light: Object.freeze({ secondary: "#475569", success: "#15803d", warning: "#b45309", danger: "#b91c1c", info: "#1d4ed8" }),
    dark: Object.freeze({ secondary: "#94a3b8", success: "#4ade80", warning: "#fbbf24", danger: "#f87171", info: "#60a5fa" }),
  });
  const families = Object.freeze(["blue", "red", "green", "orange", "pink", "gold", "purple", "yellow", "lego"]);
  return { presets, semantics, families };
})();
