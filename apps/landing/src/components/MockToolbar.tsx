import { useI18n } from "../i18n/I18nProvider";
import { EntityBadge } from "./EntityBadge";
import { Icon } from "./Icon";

export type PlacementMode = "pass" | "fail" | "shape" | null;
export type RecordState = "idle" | "recording";

interface BadgeEntity {
  name: string;
  abbreviation?: string;
  showLabel?: boolean;
}

interface MockToolbarProps {
  client: BadgeEntity;
  project: BadgeEntity;
  product: BadgeEntity;
  environmentName: string;
  color: string;
  placementMode: PlacementMode;
  onSelectPlacement: (kind: "pass" | "fail" | "shape") => void;
  onAddNote: () => void;
  hasAnnotations: boolean;
  onClearAll: () => void;
  onScreenshot: () => void;
  recordState: RecordState;
  recordElapsed: string;
  onToggleRecord: () => void;
  toolsOpen: boolean;
  onToggleTools: () => void;
  clickSpyActive: boolean;
  onToggleClickSpy: () => void;
  freezeClockActive: boolean;
  onToggleFreezeClock: () => void;
  onForceHttp: () => void;
  inspectorsCount: number;
  onOpenInspectors: () => void;
  onOpenJsonStudio: () => void;
  onOpenBreakpoint: () => void;
  testStatusOpen: boolean;
  onToggleTestStatus: () => void;
  onMinimize: () => void;
}

function contrastTextColor(hex: string): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#12141f" : "#f4f5f9";
}

export function MockToolbar({
  client,
  project,
  product,
  environmentName,
  color,
  placementMode,
  onSelectPlacement,
  onAddNote,
  hasAnnotations,
  onClearAll,
  onScreenshot,
  recordState,
  recordElapsed,
  onToggleRecord,
  toolsOpen,
  onToggleTools,
  clickSpyActive,
  onToggleClickSpy,
  freezeClockActive,
  onToggleFreezeClock,
  onForceHttp,
  inspectorsCount,
  onOpenInspectors,
  onOpenJsonStudio,
  onOpenBreakpoint,
  testStatusOpen,
  onToggleTestStatus,
  onMinimize,
}: MockToolbarProps) {
  const { t } = useI18n();
  const textColor = contrastTextColor(color);
  const btnStyle = { borderColor: textColor, color: textColor };

  return (
    <div className="qts-mock-bar" style={{ background: color, color: textColor }}>
      <div className="qts-mock-bar-crumb-wrap">
        <span className="qts-mock-client-label">
          <EntityBadge name={client.name} abbreviation={client.abbreviation} showLabel={client.showLabel} size={15} maxChars={14} />
        </span>
        <div className="qts-mock-bar-breadcrumb">
          <EntityBadge name={project.name} abbreviation={project.abbreviation} showLabel={project.showLabel} size={19} maxChars={16} />
          <Icon name="chevronDown" className="qts-mock-bar-sep" />
          <EntityBadge name={product.name} abbreviation={product.abbreviation} showLabel={product.showLabel} size={19} maxChars={16} />
          <Icon name="chevronDown" className="qts-mock-bar-sep" />
          <strong>{environmentName}</strong>
        </div>
      </div>

      <div className="qts-mock-bar-actions">
        <button
          type="button"
          className={`qts-mock-bar-btn${testStatusOpen ? " is-active" : ""}`}
          style={btnStyle}
          title={t.mockToolbar.testStatusTitle}
          onClick={onToggleTestStatus}
        >
          {t.mockToolbar.testStatus}
        </button>
        <button
          type="button"
          className={`qts-mock-bar-btn${placementMode === "pass" ? " is-active" : ""}`}
          style={btnStyle}
          title={t.mockToolbar.pass}
          onClick={() => onSelectPlacement("pass")}
        >
          <Icon name="checkLg" />
        </button>
        <button
          type="button"
          className={`qts-mock-bar-btn${placementMode === "fail" ? " is-active" : ""}`}
          style={btnStyle}
          title={t.mockToolbar.fail}
          onClick={() => onSelectPlacement("fail")}
        >
          <Icon name="xLg" />
        </button>
        <button type="button" className="qts-mock-bar-btn" style={btnStyle} title={t.mockToolbar.note} onClick={onAddNote}>
          T
        </button>
        <button
          type="button"
          className={`qts-mock-bar-btn${placementMode === "shape" ? " is-active" : ""}`}
          style={btnStyle}
          title={t.mockToolbar.shape}
          onClick={() => onSelectPlacement("shape")}
        >
          <Icon name="boundingBox" />
        </button>
        {hasAnnotations ? (
          <button type="button" className="qts-mock-bar-btn" style={btnStyle} title={t.mockToolbar.clearAll} onClick={onClearAll}>
            {t.mockToolbar.clearAll}
          </button>
        ) : null}
        <button type="button" className="qts-mock-bar-btn" style={btnStyle} title={t.mockToolbar.screenshot} onClick={onScreenshot}>
          <Icon name="camera" />
        </button>
        <button
          type="button"
          className={`qts-mock-bar-btn${recordState === "recording" ? " is-active" : ""}`}
          style={btnStyle}
          title={recordState === "recording" ? t.mockToolbar.recordStop : t.mockToolbar.recordStart}
          onClick={onToggleRecord}
        >
          <Icon name={recordState === "recording" ? "stopCircle" : "recordCircle"} />
        </button>
        {recordState === "recording" ? <span className="qts-mock-bar-timer">{recordElapsed}</span> : null}
      </div>

      <div className="qts-mock-bar-fixed">
        <div className="qts-mock-tools-wrapper">
          <button
            type="button"
            className={`qts-mock-bar-btn iconOnly${toolsOpen ? " is-active" : ""}`}
            style={btnStyle}
            title={t.mockToolbar.tools}
            onClick={onToggleTools}
          >
            <Icon name="gear" />
          </button>
          {toolsOpen ? (
            <div className="qts-mock-tools-menu" role="menu">
              <button type="button" className={clickSpyActive ? "is-active" : ""} onClick={onToggleClickSpy}>
                <Icon name="mouse2" /> {t.mockToolbar.clickSpy}
              </button>
              <button type="button" className={freezeClockActive ? "is-active" : ""} onClick={onToggleFreezeClock}>
                <Icon name="pauseCircle" /> {t.mockToolbar.freezeClock}
              </button>
              <button type="button" onClick={onForceHttp}>
                <Icon name="exclamationTriangle" /> {t.mockToolbar.forceHttp}
              </button>
              <button type="button" onClick={onOpenInspectors}>
                <Icon name="braces" /> {t.mockToolbar.inspectors}
                {inspectorsCount > 0 ? <span className="qts-mock-badge">{inspectorsCount}</span> : null}
              </button>
              <button type="button" onClick={onOpenJsonStudio}>
                <Icon name="codeSlash" /> {t.mockToolbar.jsonStudio}
              </button>
              <button type="button" onClick={onOpenBreakpoint}>
                <Icon name="rulers" /> {t.mockToolbar.breakpointViewer}
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="qts-mock-bar-btn iconOnly"
          style={btnStyle}
          title={t.mockToolbar.minimize}
          onClick={onMinimize}
        >
          <Icon name="chevronUp" />
        </button>
      </div>
    </div>
  );
}
