import { Icon } from "../components/Icon";
import { useI18n } from "../i18n/I18nProvider";

export function PrivacyPolicyPage() {
  const { t } = useI18n();

  return (
    <main className="qts-privacy-page">
      <div className="qts-container qts-privacy-inner">
        <a className="qts-back-link" href={import.meta.env.BASE_URL}>
          {t.privacy.back}
        </a>
        <span className="qts-eyebrow">{t.privacy.eyebrow}</span>
        <h1>{t.privacy.title}</h1>
        <p className="qts-section-lead">{t.privacy.lead}</p>

        <div className="qts-legal-sections">
          <section className="qts-legal-section">
            <div className="qts-legal-section-head"><Icon name="lockFill" className="qts-legal-section-icon" /><h2>{t.privacy.permissionsTitle}</h2></div>
            <div className="qts-permissions-list">
              {t.privacy.permissions.map((permission) => (
                <div key={permission.name} className="qts-permission-item">
                  <code>{permission.name}</code>
                  <p>{permission.reason}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="qts-legal-section">
            <div className="qts-legal-section-head"><Icon name="database" className="qts-legal-section-icon" /><h2>{t.privacy.collectionTitle}</h2></div>
            <p className="qts-section-lead">{t.privacy.collectionBody}</p>
          </section>

          <section className="qts-legal-section">
            <div className="qts-legal-section-head"><Icon name="gear" className="qts-legal-section-icon" /><h2>{t.privacy.processingTitle}</h2></div>
            <p className="qts-section-lead">{t.privacy.processingBody}</p>
          </section>

          <section className="qts-legal-section">
            <div className="qts-legal-section-head"><Icon name="archive" className="qts-legal-section-icon" /><h2>{t.privacy.storageTitle}</h2></div>
            <p className="qts-section-lead">{t.privacy.storageBody}</p>
          </section>

          <section className="qts-legal-section">
            <div className="qts-legal-section-head"><Icon name="share" className="qts-legal-section-icon" /><h2>{t.privacy.sharingTitle}</h2></div>
            <p className="qts-section-lead">{t.privacy.sharingBody}</p>
          </section>

          <section className="qts-legal-section">
            <div className="qts-legal-section-head"><Icon name="clock" className="qts-legal-section-icon" /><h2>{t.privacy.retentionTitle}</h2></div>
            <p className="qts-section-lead">{t.privacy.retentionBody}</p>
          </section>

          <section className="qts-legal-section">
            <div className="qts-legal-section-head"><Icon name="shieldCheck" className="qts-legal-section-icon" /><h2>{t.privacy.rightsTitle}</h2></div>
            <p className="qts-section-lead">{t.privacy.rightsBody}</p>
          </section>

          <section className="qts-legal-section">
            <div className="qts-legal-section-head"><Icon name="envelope" className="qts-legal-section-icon" /><h2>{t.privacy.contactTitle}</h2></div>
            <p className="qts-section-lead">{t.privacy.contactBody}</p>
          </section>
        </div>
      </div>
    </main>
  );
}
