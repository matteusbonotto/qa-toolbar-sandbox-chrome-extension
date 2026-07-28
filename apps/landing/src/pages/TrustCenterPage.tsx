import { useEffect } from "react";
import { Icon } from "../components/Icon";
import { useI18n } from "../i18n/I18nProvider";

// Reuses apps/landing/src/pages/PrivacyPolicyPage.tsx's `t.privacy.permissions` (the same
// verified, accurate data - never a separate copy that could drift) and `t.privacy.securityBody`,
// but presents them as a prominent, plain-language trust center instead of being buried inside
// the legal policy wall. `/permissoes` and `/seguranca` both render this page; `focus` decides
// which anchor it scrolls to on load.
export function TrustCenterPage({ focus }: { focus: "permissions" | "security" }) {
  const { t } = useI18n();

  useEffect(() => {
    const id = focus === "security" ? "trust-security" : "trust-permissions";
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [focus]);

  return (
    <main className="qts-privacy-page">
      <div className="qts-container qts-privacy-inner">
        <a className="qts-back-link" href={import.meta.env.BASE_URL}>
          {t.trust.back}
        </a>
        <span className="qts-eyebrow">{t.trust.eyebrow}</span>
        <h1>{t.trust.title}</h1>
        <p className="qts-section-lead">{t.trust.lead}</p>

        <div className="qts-legal-sections">
          <section className="qts-legal-section qts-legal-section-wide" id="trust-permissions">
            <div className="qts-legal-section-head"><Icon name="lockFill" className="qts-legal-section-icon" /><h2>{t.trust.permissionsAnchorTitle}</h2></div>
            <p className="qts-tool-lead">{t.trust.simpleExplanationBody}</p>
            <div className="qts-permissions-list">
              {t.privacy.permissions.map((permission) => (
                <div key={permission.name} className="qts-permission-item">
                  <code>{permission.name}</code>
                  <p>{permission.reason}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="qts-legal-section qts-legal-section-wide" id="trust-security">
            <div className="qts-legal-section-head"><Icon name="shieldCheck" className="qts-legal-section-icon" /><h2>{t.trust.securityAnchorTitle}</h2></div>
            <p>{t.privacy.securityBody}</p>
          </section>

          <section className="qts-legal-section">
            <div className="qts-legal-section-head"><Icon name="envelope" className="qts-legal-section-icon" /><h2>{t.privacy.contactTitle}</h2></div>
            <p className="qts-section-lead">{t.privacy.contactBody}</p>
            <a className="qts-back-link" href={`${import.meta.env.BASE_URL}privacidade`}>{t.trust.fullPolicyLinkLabel}</a>
          </section>
        </div>
      </div>
    </main>
  );
}
