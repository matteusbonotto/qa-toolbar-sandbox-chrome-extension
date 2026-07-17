import { useMemo, useState } from "react";
import { FiCopy, FiDownload, FiSearch } from "react-icons/fi";
import type { PayloadRecord } from "../services/payloadBridge";
import { diffJson, formatJson, inferJsonSchema, queryJsonPath, searchJson } from "../services/jsonStudio";

export function JsonStudio({ records }: { records: PayloadRecord[] }) {
  const [selectedId, setSelectedId] = useState(records[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [compact, setCompact] = useState(false);
  const [mode, setMode] = useState<"friendly" | "tree" | "raw" | "diff" | "schema">("friendly");
  const [jsonPath, setJsonPath] = useState("$");
  const [wrap, setWrap] = useState(true);
  const selected = records.find((record) => record.id === selectedId) ?? records[0];
  const formatted = selected ? formatJson(selected.payload, compact) : "";
  const paths = useMemo(() => selected ? searchJson(selected.payload, query) : [], [selected, query]);
  const changes = records.length > 1 ? diffJson(records[1]!.payload, records[0]!.payload) : [];
  let jsonPathResult: unknown = selected?.payload;
  let jsonPathError = "";
  try { if (selected) jsonPathResult = queryJsonPath(selected.payload, jsonPath); } catch (error) { jsonPathError = error instanceof Error ? error.message : "JSONPath inválido"; }
  if (!selected) return <div className="qtsEmptyCard"><h3>Nenhum JSON capturado</h3><p>Ative payloads no Observatory e navegue por uma API configurada.</p></div>;
  const download = () => {
    const url = URL.createObjectURL(new Blob([formatted], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `payload-${Date.now()}.json`; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="qtsJsonStudio">
    <select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{records.map((record) => <option key={record.id} value={record.id}>{record.method} {new URL(record.url, window.location.href).pathname} · {record.status}</option>)}</select>
    <div className="qtsJsonModes">{(["friendly","tree","raw","diff","schema"] as const).map((item) => <button className={mode === item ? "isActive" : ""} onClick={() => setMode(item)} key={item}>{item}</button>)}</div>
    <div className="qtsDrawerToolbar"><label><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar chave ou valor" /></label><button onClick={() => setCompact((value) => !value)}>{compact ? "Formatar" : "Compactar"}</button><button onClick={() => setWrap((value) => !value)}>{wrap ? "Sem wrap" : "Word wrap"}</button><button onClick={() => void navigator.clipboard.writeText(formatted)}><FiCopy /> Copiar</button><button onClick={download}><FiDownload /> JSON</button></div>
    <label className="qtsJsonPath">JSONPath<input value={jsonPath} onChange={(event) => setJsonPath(event.target.value)} placeholder="$.data.items[0]" /></label>{jsonPathError && <p role="alert">{jsonPathError}</p>}
    {query && <p>{paths.length} resultado(s): {paths.slice(0, 20).join(" · ")}</p>}
    {mode === "friendly" && <FriendlyJson value={jsonPathResult} />}
    {mode === "tree" && <JsonTree value={jsonPathResult} />}
    {mode === "raw" && <pre data-wrap={wrap}>{formatJson(jsonPathResult, compact)}</pre>}
    {mode === "diff" && <div className="qtsJsonDiff">{changes.length ? changes.slice(0, 500).map((change) => <p key={change.path}><b>{change.path}</b><del>{JSON.stringify(change.before)}</del><ins>{JSON.stringify(change.after)}</ins></p>) : <p>Nenhuma diferença com o payload anterior.</p>}</div>}
    {mode === "schema" && <pre data-wrap={wrap}>{JSON.stringify(inferJsonSchema(jsonPathResult), null, 2)}</pre>}
  </div>;
}

function FriendlyJson({ value }: { value: unknown }) { if (!value || typeof value !== "object") return <div className="qtsJsonScalar">{String(value ?? "null")}</div>; const entries = Object.entries(value as Record<string, unknown>).slice(0, 500); return <div className="qtsFriendlyJson">{entries.map(([key, entry]) => <article key={key}><small>{key}</small><b>{typeof entry === "object" ? JSON.stringify(entry).slice(0, 1000) : String(entry)}</b></article>)}</div>; }
function JsonTree({ value, name = "$", depth = 0 }: { value: unknown; name?: string; depth?: number }) { if (depth > 12 || !value || typeof value !== "object") return <span><b>{name}</b>: {String(value ?? "null")}</span>; return <details open={depth < 2}><summary>{name} <small>{Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`}</small></summary><div>{Object.entries(value as Record<string, unknown>).slice(0, 500).map(([key, entry]) => <JsonTree key={key} name={key} value={entry} depth={depth + 1} />)}</div></details>; }
