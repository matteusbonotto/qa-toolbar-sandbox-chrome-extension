import { useI18n } from "../i18n/I18nProvider";

export function AboutSection() {
  const { t } = useI18n();
  const pillars = [t.about.mission, t.about.vision, t.about.values];

  return (
    <section className="qts-section" id="sobre">
      <div className="qts-container">
        <span className="qts-eyebrow">{t.about.eyebrow}</span>
        <h2>{t.about.title}</h2>
        <p className="qts-section-lead">{t.about.lead}</p>
        <div className="qts-pillars">
          {pillars.map((pillar) => (
            <div key={pillar.title} className="qts-pillar-card">
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
