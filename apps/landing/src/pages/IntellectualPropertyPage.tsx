import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { loadLegalRegistration, resolveLegalStatusCopy, type LegalRegistrationRecord } from "../legal/legalRegistration";

export function IntellectualPropertyPage() {
  const { t, locale } = useI18n();
  const [legal, setLegal] = useState<LegalRegistrationRecord | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void loadLegalRegistration().then((record) => {
      setLegal(record);
      setLoaded(true);
    });
  }, []);

  const localeTag = locale === "en" ? "en-US" : locale === "es" ? "es-ES" : "pt-BR";
  const formatDate = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(localeTag) : "");
  const statusCopy = legal ? resolveLegalStatusCopy(legal, t.legal.status, formatDate) : null;

  return (
    <main className="qts-privacy-page">
      <div className="qts-container qts-privacy-inner">
        <a className="qts-back-link" href={import.meta.env.BASE_URL}>
          {t.privacy.back}
        </a>
        <span className="qts-eyebrow">{t.legal.eyebrow}</span>
        <h1>{t.legal.title}</h1>
        <p className="qts-section-lead">{t.legal.lead}</p>

        <h2>{t.legal.ownershipTitle}</h2>
        <p className="qts-section-lead">{t.legal.ownershipBody}</p>

        <h2>{t.legal.usageTitle}</h2>
        <p className="qts-section-lead">{t.legal.usageBody}</p>

        <h2>{t.legal.registrationTitle}</h2>
        {loaded && statusCopy ? (
          <div className="qts-legal-status-block" role="status">
            <strong>{statusCopy.title}</strong>
            <p className="qts-section-lead">{statusCopy.body}</p>
            {statusCopy.disclaimer ? <p className="qts-legal-disclaimer">{statusCopy.disclaimer}</p> : null}
            {legal?.publicQueryUrl ? (
              <a href={legal.publicQueryUrl} target="_blank" rel="noreferrer" className="qts-legal-query-link">
                {legal.publicQueryUrl}
              </a>
            ) : null}
            {legal?.publicNotice ? <p className="qts-section-lead">{legal.publicNotice}</p> : null}
          </div>
        ) : null}
        <p className="qts-legal-language-note">{t.legal.languageNote}</p>

        <h2>{t.legal.thirdPartyTitle}</h2>
        <p className="qts-section-lead">{t.legal.thirdPartyBody}</p>

        <h2>{t.legal.contactTitle}</h2>
        <p className="qts-section-lead">{t.legal.contactBody}</p>
      </div>
    </main>
  );
}
