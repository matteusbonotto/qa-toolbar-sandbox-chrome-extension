import type { IconName } from "../components/Icon";

// Structure only (icons/grouping) — the actual copy (titles/descriptions) lives in i18n
// translations.ts under `t.features`, keyed by these same `key` values.
export interface FeatureItem {
  key: string;
  icon: IconName;
}

export interface FeatureGroup {
  key: string;
  icon: IconName;
  items: FeatureItem[];
}

export const featureGroups: FeatureGroup[] = [
  {
    key: "evidence",
    icon: "camera",
    items: [
      { key: "testStatus", icon: "check2Circle" },
      { key: "passFail", icon: "checkSquare" },
      { key: "notesShapes", icon: "square" },
      { key: "line", icon: "dashLg" },
      { key: "blurElements", icon: "dropletHalf" },
      { key: "holofote", icon: "sunFill" },
      { key: "screenshot", icon: "camera" },
      { key: "recording", icon: "recordCircle" },
    ],
  },
  {
    key: "inspection",
    icon: "braces",
    items: [
      { key: "inspectors", icon: "braces" },
      { key: "jsonStudio", icon: "codeSlash" },
      { key: "forceHttp", icon: "exclamationTriangle" },
      { key: "errorMonitor", icon: "bug" },
      { key: "freezeClock", icon: "pauseCircle" },
      { key: "clickSpy", icon: "mouse2" },
      { key: "breakpointViewer", icon: "aspectRatio" },
      { key: "pixelPerfect", icon: "rulers" },
    ],
  },
  {
    key: "productivityKit",
    icon: "lightningCharge",
    items: [
      { key: "characterCounter", icon: "fonts" },
      { key: "multiClick", icon: "lightningCharge" },
      { key: "inputLab", icon: "checkSquare" },
      { key: "fakerFill", icon: "stars" },
    ],
  },
  {
    key: "macroStudio",
    icon: "puzzle",
    items: [{ key: "macroStudio", icon: "puzzle" }],
  },
  {
    key: "stepsRecorder",
    icon: "checkSquare",
    items: [{ key: "stepsRecorder", icon: "checkSquare" }],
  },
  {
    key: "keyView",
    icon: "keyboard",
    items: [{ key: "keyView", icon: "keyboard" }],
  },
  {
    key: "elementCapture",
    icon: "crosshair",
    items: [{ key: "elementCapture", icon: "crosshair" }],
  },
  {
    key: "sandboxData",
    icon: "key",
    items: [
      { key: "testAccounts", icon: "key" },
      { key: "paymentMethods", icon: "creditCard" },
      { key: "resources", icon: "link45deg" },
    ],
  },
];
