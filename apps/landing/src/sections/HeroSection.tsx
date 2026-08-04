import { motion } from "framer-motion";
import { Reveal } from "../components/Reveal";
import { useI18n } from "../i18n/I18nProvider";

export function HeroSection() {
  const { t } = useI18n();

  return (
    <section className="qts-hero" id="hero">
      <div className="qts-container qts-hero-grid">
        <Reveal className="qts-hero-logo-col">
          <div className="qts-hero-logo-glow" aria-hidden="true" />
          <motion.div
            className="qts-hero-logo-float"
            animate={{ y: [0, -14, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          >
            <img className="qts-hero-logo-lg qts-logo-light" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo.svg`} alt="QA Toolbar Sandbox" width={320} height={320} />
            <img className="qts-hero-logo-lg qts-logo-dark" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo-dark.svg`} alt="QA Toolbar Sandbox" width={320} height={320} />
          </motion.div>
        </Reveal>
        <div className="qts-hero-copy">
          <Reveal delay={0.04}>
            <span className="qts-eyebrow">{t.hero.eyebrow}</span>
          </Reveal>
          <Reveal delay={0.08}>
            <h1>
              {t.hero.titleLine1} <span className="qts-text-accent">{t.hero.titleGradient}</span>
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="qts-hero-lead">{t.hero.lead}</p>
          </Reveal>
          <Reveal delay={0.24} className="qts-hero-actions">
            <a className="qts-btn qts-btn-primary" href="#planos">
              {t.hero.ctaPricing}
            </a>
            <a className="qts-btn qts-btn-ghost" href={`${import.meta.env.BASE_URL}permissoes`}>
              {t.hero.ctaPermissions}
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
