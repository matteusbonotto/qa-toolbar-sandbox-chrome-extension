export type TestStatus = "pass" | "fail" | "block" | "limitation";
export type EvidenceEntry = { id: string; url: string; status: TestStatus; note: string; createdAt: string };
const key = "qtsEvidenceHistoryV1";

export async function addStatusEvidence(status: TestStatus, url: string, note = ""): Promise<EvidenceEntry> {
  const entry = { id: crypto.randomUUID(), url: new URL(url).href.slice(0, 2000), status, note: note.slice(0, 2000), createdAt: new Date().toISOString() };
  const stored = await browser.storage.local.get(key);
  const history = Array.isArray(stored[key]) ? stored[key] as EvidenceEntry[] : [];
  await browser.storage.local.set({ [key]: [entry, ...history].slice(0, 500) });
  return entry;
}

export async function evidenceHistory(): Promise<EvidenceEntry[]> {
  const stored = await browser.storage.local.get(key);
  return Array.isArray(stored[key]) ? stored[key] as EvidenceEntry[] : [];
}
