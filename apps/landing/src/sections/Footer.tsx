import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { loadLegalRegistration, type LegalRegistrationRecord } from "../legal/legalRegistration";

const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_HOLDER = "Matheus Alves Bonotto Santos";

export function Footer() {
  const { t } = useI18n();
  const [legal, setLegal] = useState<LegalRegistrationRecord | null>(null);

  useEffect(() => {
    void loadLegalRegistration().then(setLegal);
  }, []);

  return (
    <footer className="qts-footer">
      <div className="qts-container qts-footer-inner">
        <div className="qts-footer-brand">
          <img className="qts-footer-logo" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo.png`} alt="" aria-hidden="true" width={24} height={24} />
          <span>QA Toolbar Sandbox</span>
        </div>
        <nav className="qts-footer-nav">
          <a href="#sobre">{t.footer.navAbout}</a>
          <a href="#planos">{t.footer.navPricing}</a>
          <a href="#suporte">{t.footer.navSupport}</a>
          <a href={`${import.meta.env.BASE_URL}privacidade`}>{t.footer.navPrivacy}</a>
          <a href={`${import.meta.env.BASE_URL}propriedade-intelectual`}>{t.footer.navIp}</a>
        </nav>
        <p className="qts-footer-credit">
          {t.footer.creditPrefix}{" "}
          <img className="qts-footer-avatar" src="https://matheusbonotto.com.br/assets/logo-branco.png" alt="" aria-hidden="true" />{" "}
          <a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer">
            Matheus Bonotto
          </a>{" "}
          {CURRENT_YEAR}
        </p>
        <p className="qts-footer-legal">
          © {CURRENT_YEAR} {legal?.holderName ?? DEFAULT_HOLDER}. {t.footer.allRightsReserved}
          {legal ? <> · {t.legal.status[legal.status].title}</> : null}
        </p>
      </div>
    </footer>
  );
}
