import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { LOCALES } from "../i18n/translations";
import { openAccountModal } from "../lib/accountModal";
import { supabase } from "../lib/supabaseClient";

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
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);

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
    <div className="qts-site-toolbar" role="navigation" aria-label={t.meta.pageNavigation}>
      <div className="qts-site-toolbar-inner">
        <a className="qts-site-toolbar-brand" href={`${import.meta.env.BASE_URL}#hero`}>
          <img className="qts-site-toolbar-logo" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo.png`} alt="QA Toolbar Sandbox" width={28} height={28} />
          <span>QA Sandbox</span>
        </a>
        <nav className="qts-site-toolbar-nav">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`${import.meta.env.BASE_URL}#${item.id}`}
              className={`qts-site-toolbar-link${item.id === activeId ? " is-active" : ""}`}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="qts-site-toolbar-locales" role="group" aria-label={t.meta.languageSelector}>
          {LOCALES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`qts-site-toolbar-locale${option.id === locale ? " is-active" : ""}`}
              onClick={() => setLocale(option.id)}
              aria-pressed={option.id === locale}
              aria-label={t.meta.languageOption(option.label)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="qts-site-toolbar-cta" onClick={() => {
          if (signedIn) {
            const pricing = document.getElementById("planos");
            if (pricing) pricing.scrollIntoView({ behavior: "smooth" });
            else window.location.assign(`${import.meta.env.BASE_URL}#planos`);
          }
          else openAccountModal();
        }}>
          {signedIn ? t.nav.installAuthenticated : t.nav.installGuest}
        </button>
      </div>
    </div>
  );
}
