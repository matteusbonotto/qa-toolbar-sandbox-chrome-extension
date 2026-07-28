import ecosystemDiagramSvg from "../assets/ecosystem-diagram.svg?raw";
import { useI18n } from "../i18n/I18nProvider";

// The SVG is pre-rendered by scripts/render-ecosystem-diagram.mjs from the exact same mermaid
// source documented in docs/ecosystem-audit.md's "Visão geral" section - a real flowchart (nodes,
// subgraphs, labeled/dotted edges), not a hand-drawn reinterpretation. It's shipped as a static
// asset instead of the mermaid runtime (~900KB gzipped) so visiting this page doesn't cost that.
// Re-run that script whenever the diagram source or theme colors change.
export function EcosystemDiagram() {
  const { t } = useI18n();

  return (
    <div className="qts-diagram-section">
      <span className="qts-eyebrow">{t.trust.architectureEyebrow}</span>
      <h2>{t.trust.architectureTitle}</h2>
      <p className="qts-section-lead">{t.trust.architectureLead}</p>

      <div className="qts-diagram-frame">
        <div className="qts-diagram-svg" aria-label={t.trust.architectureTitle} role="img" dangerouslySetInnerHTML={{ __html: ecosystemDiagramSvg }} />
      </div>

      <p className="qts-diagram-footnote">{t.trust.architectureFootnote}</p>
    </div>
  );
}
