import { useEffect, useRef, useState } from "react";
import type { PlacementMode } from "./MockToolbar";
import { useI18n } from "../i18n/I18nProvider";

export interface MarkerItem {
  id: string;
  kind: "pass" | "fail";
  x: number;
  y: number;
}

export interface ShapeItem {
  id: string;
  x: number;
  y: number;
}

export interface NoteItem {
  id: string;
  x: number;
  y: number;
  text: string;
  editing: boolean;
}

interface MockPageProps {
  color: string;
  placementMode: PlacementMode;
  markers: MarkerItem[];
  shapes: ShapeItem[];
  notes: NoteItem[];
  onPageClick: (x: number, y: number) => void;
  onMove: (kind: "marker" | "shape" | "note", id: string, x: number, y: number) => void;
  onRemove: (kind: "marker" | "shape" | "note", id: string) => void;
  onNoteSave: (id: string, text: string) => void;
  onNoteEdit: (id: string) => void;
  clickSpyActive: boolean;
  freezeClockActive: boolean;
  onSimulateRequest: () => void;
}

function useClock(frozen: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (frozen) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [frozen]);
  return now;
}

export function MockPage({
  color,
  placementMode,
  markers,
  shapes,
  notes,
  onPageClick,
  onMove,
  onRemove,
  onNoteSave,
  onNoteEdit,
  clickSpyActive,
  freezeClockActive,
  onSimulateRequest,
}: MockPageProps) {
  const { t, locale } = useI18n();
  const clock = useClock(freezeClockActive);
  const clockLocaleTag = locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "pt-BR";
  const containerRef = useRef<HTMLDivElement | null>(null);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!placementMode) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPageClick(event.clientX - rect.left, event.clientY - rect.top);
  }

  function startDrag(event: React.MouseEvent, kind: "marker" | "shape" | "note", id: string, itemX: number, itemY: number) {
    event.preventDefault();
    event.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const offsetX = event.clientX - rect.left - itemX;
    const offsetY = event.clientY - rect.top - itemY;

    function handleMove(moveEvent: MouseEvent) {
      const nextX = Math.max(0, Math.min(rect.width, moveEvent.clientX - rect.left - offsetX));
      const nextY = Math.max(0, Math.min(rect.height, moveEvent.clientY - rect.top - offsetY));
      onMove(kind, id, nextX, nextY);
    }
    function handleUp() {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    }
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }

  return (
    <div
      ref={containerRef}
      className={`qts-mock-page${placementMode ? " is-placing" : ""}${clickSpyActive ? " is-spying" : ""}`}
      onClick={handleClick}
    >
      <div className="qts-mock-page-nav">
        <div className="qts-mock-page-logo" style={{ background: color }} />
        <div className="qts-mock-page-links">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="qts-mock-page-hero">
        <div className="qts-mock-page-title" />
        <div className="qts-mock-page-subtitle" />
        <div className="qts-mock-page-cta" style={{ background: color }} />
      </div>
      <div className="qts-mock-page-grid">
        <div className="qts-mock-page-card" />
        <div className="qts-mock-page-card" />
        <button
          type="button"
          className="qts-mock-page-card qts-mock-page-request"
          onClick={(event) => {
            event.stopPropagation();
            onSimulateRequest();
          }}
        >
          {t.mockToolbar.simulateRequest}
        </button>
      </div>

      {freezeClockActive ? (
        <div className="qts-mock-page-clock">
          🕒 {clock.toLocaleTimeString(clockLocaleTag)} {t.mockToolbar.frozenSuffix}
        </div>
      ) : null}

      {markers.map((marker) => (
        <div
          key={marker.id}
          className={`qts-mock-marker ${marker.kind === "fail" ? "isFail" : "isPass"}`}
          style={{ left: marker.x, top: marker.y }}
          onMouseDown={(event) => startDrag(event, "marker", marker.id, marker.x, marker.y)}
        >
          {marker.kind === "fail" ? "✕" : "✓"}
          <button
            type="button"
            className="qts-mock-item-remove"
            title={t.mockToolbar.remove}
            onClick={(event) => {
              event.stopPropagation();
              onRemove("marker", marker.id);
            }}
          >
            ×
          </button>
        </div>
      ))}

      {shapes.map((shape) => (
        <div
          key={shape.id}
          className="qts-mock-shape"
          style={{ left: shape.x, top: shape.y }}
          onMouseDown={(event) => startDrag(event, "shape", shape.id, shape.x, shape.y)}
        >
          <button
            type="button"
            className="qts-mock-item-remove"
            title={t.mockToolbar.remove}
            onClick={(event) => {
              event.stopPropagation();
              onRemove("shape", shape.id);
            }}
          >
            ×
          </button>
        </div>
      ))}

      {notes.map((note) =>
        note.editing ? (
          <div
            key={note.id}
            className="qts-mock-note isEditing"
            style={{ left: note.x, top: note.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="qts-mock-note-head" onMouseDown={(event) => startDrag(event, "note", note.id, note.x, note.y)}>
              <span>{t.mockToolbar.note}</span>
              <button type="button" className="qts-mock-item-remove" title={t.mockToolbar.remove} onClick={() => onRemove("note", note.id)}>
                ×
              </button>
            </div>
            <textarea
              autoFocus
              defaultValue={note.text}
              placeholder={t.mockToolbar.notePlaceholder}
              onClick={(event) => event.stopPropagation()}
              onBlur={(event) => onNoteSave(note.id, event.currentTarget.value)}
            />
          </div>
        ) : (
          <div
            key={note.id}
            className="qts-mock-note"
            style={{ left: note.x, top: note.y }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => startDrag(event, "note", note.id, note.x, note.y)}
          >
            <span className="qts-mock-note-text">{note.text}</span>
            <button type="button" className="qts-mock-item-edit" title={t.mockToolbar.edit} onClick={() => onNoteEdit(note.id)}>
              ✎
            </button>
            <button type="button" className="qts-mock-item-remove" title={t.mockToolbar.remove} onClick={() => onRemove("note", note.id)}>
              ×
            </button>
          </div>
        ),
      )}
    </div>
  );
}
