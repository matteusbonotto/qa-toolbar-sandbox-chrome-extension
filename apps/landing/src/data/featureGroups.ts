// Structure only (icons/grouping) — the actual copy (titles/descriptions) lives in i18n
// translations.ts under `t.features`, keyed by these same `key` values. Icons here are the
// exact glyphs used in the real extension toolbar menu (apps/extension/src/toolbar/toolbar.js),
// not stand-in illustrations.
export interface FeatureItem {
  key: string;
  icon: string;
}

export interface FeatureGroup {
  key: string;
  icon: string;
  items: FeatureItem[];
}

export const featureGroups: FeatureGroup[] = [
  {
    key: "evidence",
    icon: "📷",
    items: [
      { key: "testStatus", icon: "⛔" },
      { key: "passFail", icon: "✓" },
      { key: "notesShapes", icon: "▭" },
      { key: "screenshot", icon: "📷" },
      { key: "recording", icon: "⏺" },
    ],
  },
  {
    key: "inspection",
    icon: "{ }",
    items: [
      { key: "inspectors", icon: "{ }" },
      { key: "jsonStudio", icon: "🧪" },
      { key: "forceHttp", icon: "⚠" },
      { key: "freezeClock", icon: "⏸" },
      { key: "clickSpy", icon: "🖱" },
      { key: "breakpointViewer", icon: "📐" },
    ],
  },
  {
    key: "productivityKit",
    icon: "⚡",
    items: [
      { key: "characterCounter", icon: "🔤" },
      { key: "multiClick", icon: "⚡" },
      { key: "inputLab", icon: "✅" },
      { key: "fakerFill", icon: "✨" },
    ],
  },
  {
    key: "macroStudio",
    icon: "🧩",
    items: [{ key: "macroStudio", icon: "🧩" }],
  },
  {
    key: "keyView",
    icon: "⌨",
    items: [{ key: "keyView", icon: "⌨" }],
  },
  {
    key: "sandboxData",
    icon: "🔑",
    items: [
      { key: "testAccounts", icon: "🔑" },
      { key: "paymentMethods", icon: "💳" },
      { key: "resources", icon: "🔗" },
    ],
  },
];
