import type { IconName } from "../components/Icon";

// Real screen recordings captured straight from the extension (apps/extension/src/options/
// tutorial-assets/, via scripts/capture-tutorial-media.mjs), copied into public/tutorial-videos/
// for this landing build. `key` matches a featureGroups.ts item key, so the caption reuses the
// exact same verified copy already shown in the Features section (t.features.items[key]) instead
// of a separate description that could drift out of sync.
//
// Picked specifically for having an unmistakable, continuous on-screen change (a dialog opening,
// a spotlight sweeping, fields filling themselves) rather than a single quick flash - a first-time
// visitor skimming a few seconds of any of these should immediately see something happening.
export interface TutorialVideo {
  key: string;
  icon: IconName;
  file: string;
}

export const tutorialVideos: TutorialVideo[] = [
  { key: "testStatus", icon: "check2Circle", file: "testStatus" },
  { key: "multiClick", icon: "lightningCharge", file: "multiClick" },
  { key: "fakerFill", icon: "stars", file: "fakerFill" },
  { key: "holofote", icon: "sunFill", file: "holofote" },
  { key: "notesShapes", icon: "square", file: "notesShapes" },
  { key: "blurElements", icon: "dropletHalf", file: "blurElements" },
];
