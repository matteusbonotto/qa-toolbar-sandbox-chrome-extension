import { useI18n } from "../i18n/I18nProvider";

const CURRENT_YEAR = new Date().getFullYear();

export function Footer() {
  const { t } = useI18n();

  return (
    <footer className="qts-footer">
      <div className="qts-container qts-footer-inner">
        <div className="qts-footer-brand">
          <span className="qts-footer-logo" />
          <span>QA Toolbar Sandbox</span>
        </div>
        <nav className="qts-footer-nav">
          <a href="#sobre">{t.footer.navAbout}</a>
          <a href="#planos">{t.footer.navPricing}</a>
          <a href="#suporte">{t.footer.navSupport}</a>
          <a href="/privacidade">{t.footer.navPrivacy}</a>
        </nav>
        <p className="qts-footer-credit">
          {t.footer.creditPrefix} <span className="qts-footer-avatar" aria-hidden="true" />{" "}
          <a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer">
            Matheus Bonotto
          </a>{" "}
          {CURRENT_YEAR}
        </p>
      </div>
    </footer>
  );
}
