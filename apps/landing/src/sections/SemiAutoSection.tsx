import { Reveal } from "../components/Reveal";
import { useI18n } from "../i18n/I18nProvider";

const GIF_URL = "https://media.tenor.com/PPQdQblwtyAAAAAM/sabor-energ%C3%A9tico-sabor.gif";

export function SemiAutoSection() {
  const { t } = useI18n();

  return (
    <section className="qts-section qts-semiauto" id="semi-automatico">
      <div className="qts-container qts-semiauto-inner">
        <Reveal className="qts-semiauto-copy">
          <span className="qts-eyebrow">{t.semiauto.eyebrow}</span>
          <h2>
            {t.semiauto.titleLine1} <span className="qts-text-accent">{t.semiauto.titleGradient}</span>
          </h2>
          <p className="qts-section-lead">{t.semiauto.body}</p>
        </Reveal>
        <Reveal as="figure" delay={0.1} className="qts-semiauto-gif">
          <img src={GIF_URL} alt={t.semiauto.gifAlt} loading="lazy" />
        </Reveal>
      </div>
    </section>
  );
}
