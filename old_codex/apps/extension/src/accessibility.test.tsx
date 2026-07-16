import { render } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolbarApp } from "./toolbar/ToolbarApp";
import { useToolbarStore } from "./store/useToolbarStore";

describe("WCAG regression gate", () => {
  beforeEach(() => {
    const listeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();
    vi.stubGlobal("browser", { storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }, onChanged: { addListener: (listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => listeners.add(listener), removeListener: (listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => listeners.delete(listener) } }, runtime: { sendMessage: vi.fn(), openOptionsPage: vi.fn() } });
    useToolbarStore.setState({ isExpanded: true, activePanel: null, captureEnabled: false });
  });
  it("has no automatically detectable serious or critical violations", async () => {
    const { container } = render(<ToolbarApp />);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical"), result.violations.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
  });
});
