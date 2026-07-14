import { useMemo, useState } from "react";
import { FiCopy, FiDownload, FiSearch } from "react-icons/fi";
import type { PayloadRecord } from "../services/payloadBridge";
import { diffJson, formatJson, searchJson } from "../services/jsonStudio";

export function JsonStudio({ records }: { records: PayloadRecord[] }) {
  const [selectedId, setSelectedId] = useState(records[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [compact, setCompact] = useState(false);
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const formatted = selected ? formatJson(selected.payload, compact) : "";
  const paths = useMemo(() => selected ? searchJson(selected.payload, query) : [], [selected, query]);
  const changes = records.length > 1 ? diffJson(records[1]!.payload, records[0]!.payload) : [];
  if (!selected) return <div className="qtsEmptyCard"><h3>Nenhum JSON capturado</h3><p>Ative payloads no Observatory e navegue por uma API configurada.</p></div>;
  const download = () => {
    const url = URL.createObjectURL(new Blob([formatted], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `payload-${Date.now()}.json`; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="qtsJsonStudio">
    <select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{records.map((record) => <option key={record.id} value={record.id}>{record.method} {new URL(record.url, window.location.href).pathname} · {record.status}</option>)}</select>
    <div className="qtsDrawerToolbar"><label><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar chave ou valor" /></label><button onClick={() => setCompact((value) => !value)}>{compact ? "Formatar" : "Compactar"}</button><button onClick={() => void navigator.clipboard.writeText(formatted)}><FiCopy /> Copiar</button><button onClick={download}><FiDownload /> JSON</button></div>
    {query && <p>{paths.length} resultado(s): {paths.slice(0, 20).join(" · ")}</p>}<pre>{formatted}</pre>
    {changes.length > 0 && <details><summary>Diff com payload anterior ({changes.length})</summary>{changes.slice(0, 100).map((change) => <p key={change.path}><b>{change.path}</b>: {JSON.stringify(change.before)} → {JSON.stringify(change.after)}</p>)}</details>}
  </div>;
}
