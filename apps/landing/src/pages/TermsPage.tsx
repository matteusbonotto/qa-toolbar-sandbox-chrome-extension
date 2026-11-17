import { Reveal } from "../components/Reveal";
import { useI18n } from "../i18n/I18nProvider";

/** Termos de uso: mesmo layout da política de privacidade. */
export function TermsPage() {
  const { t } = useI18n();

  return (
    <main className="qts-privacy-page">
      <div className="qts-container qts-privacy-inner">
        <a className="qts-back-link" href={import.meta.env.BASE_URL}>
          {t.privacy.back}
        </a>
        <Reveal>
          <span className="qts-eyebrow">{t.terms.eyebrow}</span>
          <h1>{t.terms.title}</h1>
          <p className="qts-section-lead">{t.terms.lead}</p>
          <p className="qts-legal-effective-date">{t.terms.effectiveDate}</p>
        </Reveal>

        <div className="qts-legal-sections">
          {t.terms.sections.map((section) => (
            <section key={section.title} className="qts-legal-section qts-legal-section-wide">
              <div className="qts-legal-section-head"><h2>{section.title}</h2></div>
              <p className="qts-section-lead">{section.body}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
