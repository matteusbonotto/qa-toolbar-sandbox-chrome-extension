import { create } from "zustand";

export type PanelId = "observatory" | "payments" | "accounts" | "test-status" | "errors" | "rut" | "settings" | "inspectors" | "json-studio" | null;

interface ToolbarState {
  isExpanded: boolean;
  activePanel: PanelId;
  captureEnabled: boolean;
  toggleExpanded: () => void;
  toggleCapture: () => void;
  openPanel: (panel: Exclude<PanelId, null>) => void;
  closePanel: () => void;
}

export const useToolbarStore = create<ToolbarState>((set) => ({
  isExpanded: true,
  activePanel: null,
  captureEnabled: false,
  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded, activePanel: state.isExpanded ? null : state.activePanel })),
  toggleCapture: () => set((state) => ({ captureEnabled: !state.captureEnabled })),
  openPanel: (panel) => set((state) => ({ activePanel: state.activePanel === panel ? null : panel, isExpanded: true })),
  closePanel: () => set({ activePanel: null }),
}));
