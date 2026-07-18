import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { LOCALES } from "../i18n/translations";
import { openAccountModal } from "../lib/accountModal";

export function SiteNavToolbar() {
  const { t, locale, setLocale } = useI18n();

  const navItems = useMemo(
    () => [
      { id: "hero", label: t.nav.home },
      { id: "sobre", label: t.nav.about },
      { id: "simulador", label: t.nav.simulator },
      { id: "semi-automatico", label: t.nav.semiauto },
      { id: "ferramentas", label: t.nav.features },
      { id: "planos", label: t.nav.pricing },
      { id: "suporte", label: t.nav.support },
    ],
    [t],
  );

  const [activeId, setActiveId] = useState(navItems[0]!.id);

  useEffect(() => {
    const sections = navItems.map((item) => document.getElementById(item.id)).filter(
      (el): el is HTMLElement => el !== null,
    );

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          setActiveId(visible.target.id);
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [navItems]);

  return (
    <div className="qts-site-toolbar" role="navigation" aria-label="Navegação da página">
      <div className="qts-site-toolbar-inner">
        <div className="qts-site-toolbar-brand">
          <span className="qts-site-toolbar-dot" />
          <span>QA Sandbox</span>
        </div>
        <nav className="qts-site-toolbar-nav">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`qts-site-toolbar-link${item.id === activeId ? " is-active" : ""}`}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="qts-site-toolbar-locales" role="group" aria-label="Idioma">
          {LOCALES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`qts-site-toolbar-locale${option.id === locale ? " is-active" : ""}`}
              onClick={() => setLocale(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="qts-site-toolbar-cta" onClick={openAccountModal}>
          {t.nav.install}
        </button>
      </div>
    </div>
  );
}
