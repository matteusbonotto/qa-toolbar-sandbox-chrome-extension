import { useI18n } from "../i18n/I18nProvider";

export function SemiAutoSection() {
  const { t } = useI18n();

  return (
    <section className="qts-section qts-semiauto" id="semi-automatico">
      <div className="qts-container qts-semiauto-inner">
        <div className="qts-semiauto-copy">
          <span className="qts-eyebrow">{t.semiauto.eyebrow}</span>
          <h2>
            {t.semiauto.titleLine1} <span className="qts-text-gradient">{t.semiauto.titleGradient}</span>
          </h2>
          <p className="qts-section-lead">{t.semiauto.body}</p>
        </div>
      </div>
    </section>
  );
}
