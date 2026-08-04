import { useEffect, useState } from "react";
import { Reveal } from "../components/Reveal";
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
      <Reveal className="qts-container qts-footer-inner" delay={0}>
        <div className="qts-footer-col qts-footer-col-brand">
          <img className="qts-footer-logo qts-logo-light" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo.svg`} alt="QA Toolbar Sandbox" width={96} height={96} />
          <img className="qts-footer-logo qts-logo-dark" src={`${import.meta.env.BASE_URL}qa-toolbar-sandbox-logo-dark.svg`} alt="QA Toolbar Sandbox" width={96} height={96} />
          <div className="qts-footer-brand">
            <span>QA Toolbar Sandbox</span>
            <p className="qts-footer-tagline">{t.hero.eyebrow}</p>
          </div>
        </div>
        <nav className="qts-footer-col" aria-label={t.footer.colProduct}>
          <span className="qts-footer-col-title">{t.footer.colProduct}</span>
          <a href={`${import.meta.env.BASE_URL}#sobre`}>{t.footer.navAbout}</a>
          <a href={`${import.meta.env.BASE_URL}#planos`}>{t.footer.navPricing}</a>
          <a href={`${import.meta.env.BASE_URL}#suporte`}>{t.footer.navSupport}</a>
        </nav>
        <nav className="qts-footer-col" aria-label={t.footer.colTrust}>
          <span className="qts-footer-col-title">{t.footer.colTrust}</span>
          <a href={`${import.meta.env.BASE_URL}permissoes`}>{t.footer.navTrust}</a>
          <a href={`${import.meta.env.BASE_URL}privacidade`}>{t.footer.navPrivacy}</a>
          <a href={`${import.meta.env.BASE_URL}propriedade-intelectual`}>{t.footer.navIp}</a>
        </nav>
        <div className="qts-footer-bottom">
          <p className="qts-footer-legal">
            © {CURRENT_YEAR} {legal?.holderName ?? DEFAULT_HOLDER}. {t.footer.allRightsReserved}
            {legal ? <> · {t.legal.status[legal.status].title}</> : null}
          </p>
          <p className="qts-footer-credit">
            {t.footer.creditPrefix}{" "}
            <img className="qts-footer-avatar" src="https://matheusbonotto.com.br/assets/logo-branco.png" alt="" aria-hidden="true" />{" "}
            <a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer">
              Matheus Bonotto
            </a>{" "}
            {CURRENT_YEAR}
          </p>
        </div>
      </Reveal>
    </footer>
  );
}
