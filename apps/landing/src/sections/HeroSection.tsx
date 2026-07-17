import { ToolbarSimulator } from "../components/ToolbarSimulator";
import { useI18n } from "../i18n/I18nProvider";

export function HeroSection() {
  const { t } = useI18n();

  return (
    <section className="qts-hero" id="hero">
      <div className="qts-container qts-hero-inner">
        <div className="qts-hero-copy">
          <span className="qts-eyebrow">{t.hero.eyebrow}</span>
          <h1>
            {t.hero.titleLine1} <span className="qts-text-gradient">{t.hero.titleGradient}</span>
          </h1>
          <p className="qts-hero-lead">{t.hero.lead}</p>
          <div className="qts-hero-actions">
            <a className="qts-btn qts-btn-primary" href="#planos">
              {t.hero.ctaPricing}
            </a>
            <a className="qts-btn qts-btn-ghost" href="#simulador">
              {t.hero.ctaSimulate}
            </a>
          </div>
        </div>
      </div>
      <div className="qts-container" id="simulador">
        <ToolbarSimulator />
      </div>
    </section>
  );
}
