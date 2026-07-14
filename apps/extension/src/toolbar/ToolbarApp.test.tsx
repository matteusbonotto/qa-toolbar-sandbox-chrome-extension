import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToolbarStore } from "../store/useToolbarStore";
import { ToolbarApp } from "./ToolbarApp";

describe("ToolbarApp", () => {
  beforeEach(async () => {
    class FakeMediaRecorder {
      static isTypeSupported = () => true;
      state: RecordingState = "inactive";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}
      start() { this.state = "recording"; }
      pause() { this.state = "paused"; }
      resume() { this.state = "recording"; }
      stop() { this.state = "inactive"; }
      addEventListener() {}
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getDisplayMedia: vi.fn(async () => ({ getTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }] })) } });
    let data: Record<string, unknown> = {};
    const listeners = new Set<(changes: Record<string, { newValue?: unknown }>, areaName: string) => void>();
    vi.stubGlobal("browser", { storage: { local: {
      get: vi.fn(async () => ({ ...data })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        data = { ...data, ...items };
        const changes = Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { newValue }]));
        listeners.forEach((listener) => listener(changes, "local"));
      }),
      clear: vi.fn(async () => { data = {}; }),
    }, onChanged: {
      addListener: (listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void) => listeners.add(listener),
      removeListener: (listener: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void) => listeners.delete(listener),
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
    await waitFor(() => expect(screen.getByText("PRO · PRONTO PARA TESTAR")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Start local capture" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause local capture" })).toBeInTheDocument());
  });

  it("opens the legacy Tools menu and Test Status drawer", () => {
    render(<ToolbarApp />);
    const tools = screen.getByRole("button", { name: /ferramentas/i });
    fireEvent.click(tools);
    expect(tools).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Test Status" }));
    expect(screen.getByRole("complementary", { name: "test-status panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pass$/i })).toBeInTheDocument();
  });

  it("selects the imported environment from the current URL", async () => {
    const projectId = "b6a99e41-dd22-48e5-a332-c14d57eb7759";
    await browser.storage.local.set({
      qtsActiveProjectId: projectId,
      qtsProjects: [{
        id: projectId,
        name: "Demo Workspace",
        accentColor: "#7c5cff",
        environments: [{ id: "c44e3a25-5214-41df-98cc-965da9ce7d31", name: "BETA", color: "#3b82f6", riskLevel: "medium", urlPatterns: ["localhost"] }],
      }],
    });
    render(<ToolbarApp />);
    await waitFor(() => expect(screen.getByText("BETA")).toBeInTheDocument());
    expect(screen.getByTitle("Demo Workspace")).toBeInTheDocument();
  });

  it("minimizes the top windowsill and exposes a restore control", () => {
    render(<ToolbarApp />);
    expect(document.getElementById("qts-windowsill-page-spacer")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Ocultar toolbar"));
    expect(screen.getByTitle("Mostrar QA Toolbar")).toBeInTheDocument();
    expect(document.getElementById("qts-windowsill-page-spacer")).not.toBeInTheDocument();
  });
});
