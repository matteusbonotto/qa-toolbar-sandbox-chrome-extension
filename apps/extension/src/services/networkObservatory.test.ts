import { describe, expect, it, vi } from "vitest";
import { startNetworkObservatory, type NetworkRecord } from "./networkObservatory";

describe("network observatory", () => {
  it("maps real resource timing entries without inventing status", () => {
    const disconnect = vi.fn();
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ name: "https://example.test/api", initiatorType: "fetch", startTime: 10, duration: 42, transferSize: 123, encodedBodySize: 100 } as PerformanceResourceTiming]);
    vi.stubGlobal("PerformanceObserver", class { constructor(_callback: PerformanceObserverCallback) {} observe() {} disconnect = disconnect; });
    let received: NetworkRecord[] = [];
    const stop = startNetworkObservatory((records) => { received = records; });
    expect(received[0]).toMatchObject({ kind: "fetch", durationMs: 42, status: null });
    stop(); expect(disconnect).toHaveBeenCalled();
  });
});
