import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, translations, type Dictionary, type Locale } from "./translations";

const STORAGE_KEY = "qts-landing-locale";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "pt-BR" || stored === "es" || stored === "en") return stored;

  const browserLang = window.navigator.language.toLowerCase();
  if (browserLang.startsWith("es")) return "es";
  if (browserLang.startsWith("en")) return "en";
  return "pt-BR";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  function setLocale(next: Locale) {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: translations[locale] }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
