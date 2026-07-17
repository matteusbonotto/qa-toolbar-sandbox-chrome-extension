import { useI18n } from "../i18n/I18nProvider";

export function PrivacyPolicyPage() {
  const { t } = useI18n();

  return (
    <main className="qts-privacy-page">
      <div className="qts-container qts-privacy-inner">
        <a className="qts-back-link" href="/">
          {t.privacy.back}
        </a>
        <span className="qts-eyebrow">{t.privacy.eyebrow}</span>
        <h1>{t.privacy.title}</h1>
        <p className="qts-section-lead">{t.privacy.lead}</p>

        <h2>{t.privacy.permissionsTitle}</h2>
        <div className="qts-permissions-list">
          {t.privacy.permissions.map((permission) => (
            <div key={permission.name} className="qts-permission-item">
              <code>{permission.name}</code>
              <p>{permission.reason}</p>
            </div>
          ))}
        </div>

        <h2>{t.privacy.dataTitle}</h2>
        <p className="qts-section-lead">{t.privacy.dataBody}</p>

        <h2>{t.privacy.accountTitle}</h2>
        <p className="qts-section-lead">{t.privacy.accountBody}</p>

        <h2>{t.privacy.contactTitle}</h2>
        <p className="qts-section-lead">{t.privacy.contactBody}</p>
      </div>
    </main>
  );
}
