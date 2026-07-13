import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToolbarStore } from "../store/useToolbarStore";
import { ToolbarApp } from "./ToolbarApp";

describe("ToolbarApp", () => {
  beforeEach(async () => {
    let data: Record<string, unknown> = {};
    const listeners = new Set<(changes: Record<string, { newValue?: unknown }>) => void>();
    vi.stubGlobal("browser", { storage: { local: {
      get: vi.fn(async () => ({ ...data })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        data = { ...data, ...items };
        const changes = Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { newValue }]));
        listeners.forEach((listener) => listener(changes));
      }),
      clear: vi.fn(async () => { data = {}; }),
      onChanged: { addListener: (listener: (changes: Record<string, { newValue?: unknown }>) => void) => listeners.add(listener), removeListener: (listener: (changes: Record<string, { newValue?: unknown }>) => void) => listeners.delete(listener) },
    } } });
    useToolbarStore.setState({ isExpanded: true, activePanel: null, captureEnabled: false });
  });

  it("opens and closes the Observatory panel", () => {
    render(<ToolbarApp />);
    fireEvent.click(screen.getByTitle("Observatory"));
    expect(screen.getByRole("complementary", { name: "observatory panel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("toggles capture when the synchronized plan enables recording", async () => {
    await browser.storage.local.set({ qtsEntitlementCache: {
      plan: { key: "pro", name: "Pro" },
      features: { "recording.enabled": true },
      trial: { active: false, endsAt: null, daysRemaining: 0 },
      referral: { code: null, qualified: 0 },
      checkedAt: new Date().toISOString(),
    } });
    render(<ToolbarApp />);
    await waitFor(() => expect(screen.getByText("PRO · READY TO TEST")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Start local capture" }));
    expect(screen.getByRole("button", { name: "Pause local capture" })).toBeInTheDocument();
  });

  it("opens the legacy Tools menu and Test Status drawer", () => {
    render(<ToolbarApp />);
    const tools = screen.getByRole("button", { name: /tools/i });
    fireEvent.click(tools);
    expect(tools).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Test Status" }));
    expect(screen.getByRole("complementary", { name: "test-status panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pass$/i })).toBeInTheDocument();
  });

  it("minimizes the top windowsill and exposes a restore control", () => {
    render(<ToolbarApp />);
    fireEvent.click(screen.getByTitle("Ocultar toolbar"));
    expect(screen.getByTitle("Mostrar QA Toolbar")).toBeInTheDocument();
  });
});
