import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useI18n } from "../i18n/I18nProvider";
import { LOCALES } from "../i18n/translations";
import { openAccountModal } from "../lib/accountModal";
import { supabase } from "../lib/supabaseClient";
import { signOut } from "../services/checkout";
import { Icon } from "./Icon";

export function SiteNavToolbar() {
  const { t, locale, setLocale } = useI18n();

  const navItems = useMemo(
    () => [
      { id: "hero", label: t.nav.home },
      { id: "sobre", label: t.nav.about },
      { id: "semi-automatico", label: t.nav.semiauto },
      { id: "ferramentas", label: t.nav.features },
      { id: "tutoriais", label: t.nav.tutorials },
      { id: "planos", label: t.nav.pricing },
      { id: "suporte", label: t.nav.support },
    ],
    [t],
  );

  const [activeId, setActiveId] = useState(navItems[0]!.id);
  const [signedIn, setSignedIn] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

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
          <img className="qts-site-toolbar-logo qts-logo-light" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo.svg`} alt="QA Toolbar Sandbox" width={28} height={28} />
          <img className="qts-site-toolbar-logo qts-logo-dark" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo-dark.svg`} alt="QA Toolbar Sandbox" width={28} height={28} />
          <span>QA Sandbox</span>
        </a>
        <nav className="qts-site-toolbar-nav">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`${import.meta.env.BASE_URL}#${item.id}`}
              className={`qts-site-toolbar-link${item.id === activeId ? " is-active" : ""}`}
              aria-current={item.id === activeId ? "true" : undefined}
            >
              {item.id === activeId ? (
                <motion.span
                  layoutId="qts-nav-pill"
                  className="qts-site-toolbar-pill"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <span className="qts-site-toolbar-link-label">{item.label}</span>
            </a>
          ))}
        </nav>
        <button
          type="button"
          className="qts-site-toolbar-menu-btn"
          aria-expanded={mobileOpen}
          aria-controls="qts-mobile-nav"
          aria-label={mobileOpen ? t.meta.closeMenu : t.meta.openMenu}
          onClick={() => setMobileOpen((value) => !value)}
        >
          <Icon name={mobileOpen ? "xLg" : "list"} />
        </button>
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
        {signedIn ? (
          <button type="button" className="qts-site-toolbar-account" onClick={() => openAccountModal()}>
            {t.nav.myAccount}
          </button>
        ) : null}
        <button type="button" className="qts-site-toolbar-cta" onClick={() => {
          if (signedIn) void signOut();
          else openAccountModal();
        }}>
          {signedIn ? t.nav.navSignOut : t.nav.install}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {mobileOpen ? (
          <motion.nav
            id="qts-mobile-nav"
            className="qts-site-toolbar-mobile-nav"
            aria-label={t.meta.pageNavigation}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {navItems.map((item) => (
              <a
                key={item.id}
                href={`${import.meta.env.BASE_URL}#${item.id}`}
                className={`qts-site-toolbar-mobile-link${item.id === activeId ? " is-active" : ""}`}
                aria-current={item.id === activeId ? "true" : undefined}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </a>
            ))}
          </motion.nav>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
