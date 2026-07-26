import { useRef } from "react";

interface SegmentedOption {
  id: string;
  label: string;
  swatch?: string;
}

interface SegmentedControlProps {
  label: string;
  options: SegmentedOption[];
  value: string;
  onChange: (id: string) => void;
}

export function SegmentedControl({ label, options, value, onChange }: SegmentedControlProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const moveSelection = (direction: 1 | -1) => {
    const current = Math.max(0, options.findIndex((option) => option.id === value));
    const next = (current + direction + options.length) % options.length;
    onChange(options[next]!.id);
    requestAnimationFrame(() => groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus());
  };
  return (
    <div className="qts-sim-field">
      {label ? <span className="qts-sim-field-label">{label}</span> : null}
      <div ref={groupRef} className="qts-segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === value}
            tabIndex={option.id === value ? 0 : -1}
            className={`qts-segmented-btn${option.id === value ? " is-active" : ""}`}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); moveSelection(1); }
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); moveSelection(-1); }
            }}
          >
            {option.swatch ? (
              <span className="qts-segmented-swatch" style={{ background: option.swatch }} />
            ) : null}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
