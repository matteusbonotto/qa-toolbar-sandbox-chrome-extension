export type DeviceFrame = "phone" | "tablet" | "laptop" | "monitor" | "none";
export type BreakpointPreset = { id: string; name: string; width: number; height: number; frame: DeviceFrame; favorite: boolean };
export const defaultBreakpointPresets: readonly BreakpointPreset[] = [
  { id: "mobile-small", name: "Mobile Small", width: 320, height: 568, frame: "phone", favorite: false },
  { id: "mobile", name: "Mobile", width: 375, height: 667, frame: "phone", favorite: true },
  { id: "mobile-large", name: "Mobile Large", width: 430, height: 932, frame: "phone", favorite: false },
  { id: "tablet-portrait", name: "Tablet Portrait", width: 768, height: 1024, frame: "tablet", favorite: false },
  { id: "tablet-landscape", name: "Tablet Landscape", width: 1024, height: 768, frame: "tablet", favorite: false },
  { id: "laptop", name: "Laptop", width: 1366, height: 768, frame: "laptop", favorite: true },
  { id: "desktop", name: "Desktop", width: 1440, height: 900, frame: "monitor", favorite: false },
  { id: "desktop-large", name: "Desktop Large", width: 1920, height: 1080, frame: "monitor", favorite: false },
];
export function validateDimensions(width: number, height: number): boolean { return Number.isInteger(width) && Number.isInteger(height) && width >= 200 && width <= 7680 && height >= 300 && height <= 4320; }
export function rotatePreset(preset: BreakpointPreset): BreakpointPreset { return { ...preset, width: preset.height, height: preset.width }; }
