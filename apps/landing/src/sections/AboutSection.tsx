import { Reveal } from "../components/Reveal";
import { Icon, type IconName } from "../components/Icon";
import { useI18n } from "../i18n/I18nProvider";

const PILLAR_ICONS: IconName[] = ["bullseye", "binoculars", "gem"];

export function AboutSection() {
  const { t } = useI18n();
  const pillars = [t.about.mission, t.about.vision, t.about.values];

  return (
    <section className="qts-section qts-zone-tint" id="sobre">
      <div className="qts-container">
        <Reveal className="qts-section-head">
          <div className="qts-section-head-main">
            <span className="qts-eyebrow">{t.about.eyebrow}</span>
            <h2>{t.about.title}</h2>
          </div>
          <p className="qts-section-head-lead">{t.about.lead}</p>
        </Reveal>
        <div className="qts-pillars">
          {pillars.map((pillar, index) => (
            <Reveal key={pillar.title} delay={index * 0.08} className="qts-pillar-card">
              <span className="qts-pillar-icon">
                <Icon name={PILLAR_ICONS[index]!} />
              </span>
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
