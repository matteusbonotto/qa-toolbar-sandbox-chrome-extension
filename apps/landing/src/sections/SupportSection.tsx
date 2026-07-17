import { useI18n } from "../i18n/I18nProvider";

export function SupportSection() {
  const { t } = useI18n();

  return (
    <section className="qts-section qts-support" id="suporte">
      <div className="qts-container qts-support-grid">
        <div className="qts-support-card">
          <span className="qts-eyebrow">{t.support.eyebrow1}</span>
          <h2>{t.support.title1}</h2>
          <p className="qts-section-lead">{t.support.body1}</p>
          <a className="qts-btn qts-btn-ghost" href="mailto:contato@matheusbonotto.com.br">
            {t.support.cta1}
          </a>
        </div>
        <div className="qts-support-card">
          <span className="qts-eyebrow">{t.support.eyebrow2}</span>
          <h2>{t.support.title2}</h2>
          <p className="qts-section-lead">{t.support.body2}</p>
          <a className="qts-btn qts-btn-primary" href="mailto:contato@matheusbonotto.com.br">
            {t.support.cta2}
          </a>
        </div>
      </div>
    </section>
  );
}
