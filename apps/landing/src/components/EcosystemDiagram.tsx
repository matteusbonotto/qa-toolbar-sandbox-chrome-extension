import { Icon, type IconName } from "./Icon";
import { useI18n } from "../i18n/I18nProvider";

function DiagramNode({ icon, label, caption }: { icon: IconName; label: string; caption: string }) {
  return (
    <div className="qts-diagram-node">
      <span className="qts-diagram-node-icon"><Icon name={icon} /></span>
      <span className="qts-diagram-node-body">
        <strong>{label}</strong>
        <span>{caption}</span>
      </span>
    </div>
  );
}

function DiagramFlow({ label }: { label: string }) {
  return (
    <div className="qts-diagram-flow">
      <span className="qts-diagram-flow-line" />
      <span className="qts-diagram-flow-label">{label}</span>
    </div>
  );
}

// Visualizes the same architecture documented in docs/ecosystem-audit.md's mermaid diagram (three
// independent apps in one monorepo, one shared Supabase project, no backend of our own outside
// its Edge Functions) as a hand-built CSS diagram instead of embedding a mermaid runtime - keeps
// it dependency-free and themeable with the rest of the site.
export function EcosystemDiagram() {
  const { t } = useI18n();
  const n = t.trust.architectureNodes;
  const f = t.trust.architectureFlows;

  return (
    <div className="qts-diagram-section">
      <span className="qts-eyebrow">{t.trust.architectureEyebrow}</span>
      <h2>{t.trust.architectureTitle}</h2>
      <p className="qts-section-lead">{t.trust.architectureLead}</p>

      <div className="qts-diagram">
        <div className="qts-diagram-col qts-diagram-col-client">
          <span className="qts-diagram-col-label">{t.trust.architectureGroupClient}</span>
          <DiagramNode icon="share" label={n.landing.label} caption={n.landing.caption} />
          <DiagramNode icon="shield" label={n.admin.label} caption={n.admin.caption} />
          <DiagramNode icon="puzzle" label={n.extension.label} caption={n.extension.caption} />
        </div>

        <DiagramFlow label={f.clientToBackend} />

        <div className="qts-diagram-col qts-diagram-col-backend">
          <span className="qts-diagram-col-label">{t.trust.architectureGroupBackend}</span>
          <DiagramNode icon="database" label={n.postgres.label} caption={n.postgres.caption} />
          <DiagramNode icon="key" label={n.auth.label} caption={n.auth.caption} />
          <DiagramNode icon="gear" label={n.edgeFunctions.label} caption={n.edgeFunctions.caption} />
        </div>

        <DiagramFlow label={f.backendToStripe} />

        <div className="qts-diagram-col qts-diagram-col-external">
          <span className="qts-diagram-col-label">{t.trust.architectureGroupExternal}</span>
          <DiagramNode icon="creditCard" label={n.stripe.label} caption={n.stripe.caption} />
          <DiagramNode icon="envelope" label={n.email.label} caption={n.email.caption} />
          <DiagramNode icon="link45deg" label={n.chromeStore.label} caption={n.chromeStore.caption} />
        </div>
      </div>

      <p className="qts-diagram-footnote">{t.trust.architectureFootnote}</p>
    </div>
  );
}
