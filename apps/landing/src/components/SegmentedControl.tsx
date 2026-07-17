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
  return (
    <div className="qts-sim-field">
      {label ? <span className="qts-sim-field-label">{label}</span> : null}
      <div className="qts-segmented" role="tablist" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={option.id === value}
            className={`qts-segmented-btn${option.id === value ? " is-active" : ""}`}
            onClick={() => onChange(option.id)}
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
