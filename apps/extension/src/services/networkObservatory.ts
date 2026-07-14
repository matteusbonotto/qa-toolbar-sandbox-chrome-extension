export type NetworkRecord = { id: string; url: string; method: string; kind: "fetch" | "xhr" | "resource"; durationMs: number; sizeBytes: number; status: number | null; startedAt: string };

export function startNetworkObservatory(onRecords: (records: NetworkRecord[]) => void, maximum = 500): () => void {
  const records = new Map<string, NetworkRecord>();
  const ingest = (entry: PerformanceResourceTiming) => {
    if (!/^https?:/i.test(entry.name)) return;
    const kind = entry.initiatorType === "fetch" ? "fetch" : entry.initiatorType === "xmlhttprequest" ? "xhr" : "resource";
    const responseStatus = "responseStatus" in entry && typeof (entry as PerformanceResourceTiming & { responseStatus?: unknown }).responseStatus === "number" ? Number((entry as PerformanceResourceTiming & { responseStatus: number }).responseStatus) : null;
    const id = `${entry.name}:${entry.startTime.toFixed(2)}`;
    records.set(id, { id, url: entry.name.slice(0, 2000), method: "GET", kind, durationMs: Math.round(entry.duration), sizeBytes: Math.max(0, entry.transferSize || entry.encodedBodySize), status: responseStatus, startedAt: new Date(performance.timeOrigin + entry.startTime).toISOString() });
    while (records.size > maximum) records.delete(records.keys().next().value!);
    onRecords([...records.values()].reverse());
  };
  performance.getEntriesByType("resource").forEach((entry) => ingest(entry as PerformanceResourceTiming));
  const observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => ingest(entry as PerformanceResourceTiming)));
  observer.observe({ type: "resource", buffered: true });
  return () => observer.disconnect();
}
