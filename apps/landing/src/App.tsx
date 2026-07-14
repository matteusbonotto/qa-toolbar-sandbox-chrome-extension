import { useEffect, useRef, useState, type CSSProperties } from "react";
import { isLocale, isThemeKey, localizeDom, planCatalog, themeCatalog, translate, type BillingCycle, type ColorMode, type Locale, type ThemeKey } from "@qts/domain";
import {
  FiActivity, FiArrowRight, FiCamera, FiCheck, FiChevronDown, FiCode, FiCreditCard,
  FiDatabase, FiDownload, FiEye, FiHardDrive, FiLock,
  FiMenu, FiMoon, FiMousePointer, FiPackage, FiShield, FiSliders, FiSun, FiX, FiZap,
  FiUsers,
} from "react-icons/fi";
import brandLogo from "./assets/images/logo.svg";
import { createLandingCommerce, hasReleaseAccess, type PriceKey, type PromotionStatus } from "./services/commerce";

const mockWorkspaceUrl = `${import.meta.env.BASE_URL}downloads/qa-toolbar-demo-workspace.json`;
const privacyPolicyUrl = `${import.meta.env.BASE_URL}privacy-policy/`;
const chromeStoreFallback = "https://chromewebstore.google.com/";
const commerce = createLandingCommerce();

const features = [
  { icon: FiCheck, title: "Status do teste", text: "Marque Pass, Fail, Blocked ou Limitation e mantenha o resultado visível enquanto investiga." },
  { icon: FiUsers, title: "Contas de teste", text: "Cadastre usuários por cliente, produto, ambiente e tipo de perfil; copie os dados sem procurar em planilhas ou chats." },
  { icon: FiCreditCard, title: "Métodos de pagamento", text: "Organize cartões e meios sandbox por bandeira, país e cenário, com dados sensíveis protegidos e acesso rápido." },
  { icon: FiCamera, title: "Screenshots e anotações", text: "Capture a tela, destaque pontos importantes e gere evidências mais claras para bugs, histórias e homologações." },
  { icon: FiDownload, title: "Gravação MP4 e GIF", text: "Grave, pause, retome e baixe em MP4; para GIF, a conversão usa sua conta Convertio com consentimento." },
  { icon: FiEye, title: "Breakpoint Viewer", text: "Compare celular e desktop lado a lado, com molduras, presets, rotação e fallback para sites que bloqueiam iframe." },
  { icon: FiActivity, title: "Freeze, Click Spy e Inspectors", text: "Congele a interface, inspecione cliques, JSON, rede, storage e acessibilidade no contexto do teste." },
  { icon: FiDatabase, title: "Projetos e ambientes", text: "Relacione clientes, produtos, projetos, URLs e ambientes para a toolbar abrir sempre no contexto correto." },
  { icon: FiCode, title: "APIs e JSON Studio", text: "Salve endpoints, headers sandbox e payloads, compare respostas JSON e investigue chamadas sem perder o fluxo." },
  { icon: FiZap, title: "HTTP Controls", text: "Force respostas e cenários de erro controlados para validar estados difíceis de reproduzir no dia a dia." },
  { icon: FiSliders, title: "Toolbar do seu jeito", text: "Fixe e desafixe ferramentas, altere tema e idioma e deixe visíveis apenas os atalhos que você realmente usa." },
  { icon: FiHardDrive, title: "Barra de ferramentas portátil", text: "Importe, exporte, limpe cache ou resete configurações locais com escopo e confirmação antes de apagar." },
];

const installSteps = [
  ["01", "Crie sua conta", "Cadastre seu e-mail e confirme o acesso."],
  ["02", "Escolha seu plano", "Comece com 30 dias grátis ou escolha cobrança mensal ou anual."],
  ["03", "Conclua o acesso", "Use seu voucher ou finalize o pagamento seguro no Stripe."],
  ["04", "Instale e teste", "Abra a Chrome Web Store, instale e configure seu primeiro projeto."],
];

const faqs = [
  ["A ferramenta é manual?", "Ela respeita o controle do QA: você escolhe contexto, URLs e evidências. Mas tem sabor de automação com atalhos, inspectors, contas e pagamentos sandbox organizados."],
  ["Ainda preciso baixar ZIP?", "Não. Após a validação do acesso, o fluxo direciona para a Chrome Web Store."],
  ["A extensão se atualiza sozinha?", "Sim. Instalada pela Chrome Web Store, ela acompanha as versões publicadas na loja."],
  ["Quais sites funcionam?", "As URLs são definidas por projeto e ambiente. Você pode usar domínios, caminhos e curingas; o Chrome solicita permissão somente quando necessário."],
  ["Como o acesso é liberado?", "O Stripe processa cobranças pagas e o backend confirma o webhook. Vouchers são resgatados uma única vez e geram acesso diretamente no Supabase."],
  ["Consigo gravar MP4 e GIF?", "Sim. MP4 é usado nativamente quando o navegador suporta; caso contrário, a captura é convertida. GIF usa a API Convertio com uma chave fornecida por você."],
  ["O Breakpoint Viewer substitui um dispositivo real?", "Não. Ele simula dimensões em celular e desktop, inclusive lado a lado. Sites que bloqueiam iframe podem ser abertos externamente."],
  ["Meus projetos ficam na nuvem?", "Projetos, URLs, contas sandbox, preferências e evidências permanecem localmente por padrão. Supabase guarda somente conta e acesso; Stripe processa pagamentos."],
];

export function App() {
  const localizedRootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [accessOpen, setAccessOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<"free" | PriceKey>("free");
  const [authenticated, setAuthenticated] = useState(false);
  const [releaseReady, setReleaseReady] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessMessage, setAccessMessage] = useState("");
  const [voucherCode, setVoucherCode] = useState("");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("yearly");
  const [launchPromotion, setLaunchPromotion] = useState<PromotionStatus | null>(null);
  const [locale, setLocale] = useState<Locale>(() => { const saved = window.localStorage.getItem("qtsLocale"); return isLocale(saved) ? saved : "pt-BR"; });
  const t = (key: string, values?: Record<string, string | number>) => translate(locale, key, values);
  useEffect(() => localizedRootRef.current ? localizeDom(localizedRootRef.current, locale) : undefined, [locale]);
  const [theme, setTheme] = useState<ThemeKey>(() => {
    const saved = window.localStorage.getItem("qtsTheme");
    return isThemeKey(saved) ? saved : "red";
  });
  const [colorMode, setColorMode] = useState<ColorMode>(() => window.localStorage.getItem("qtsColorMode") === "light" ? "light" : "dark");

  const openChromeStore = (url = chromeStoreFallback) => {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.hostname !== "chromewebstore.google.com") throw new Error("Endereço da Chrome Store inválido.");
    window.location.assign(target.href);
  };

  const redeemVoucher = async () => {
    if (!commerce) return;
    setAccessBusy(true);
    try {
      const token = await commerce.accessToken();
      if (!token) throw new Error("Entre na sua conta antes de resgatar um voucher.");
      const result = await commerce.redeemVoucher(token, voucherCode.trim().toUpperCase());
      setVoucherCode("");
      setAccessMessage(`${result.label} ativado com sucesso.`);
      await verifyAccess(false);
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "Voucher indisponível.");
    } finally {
      setAccessBusy(false);
    }
  };

  const verifyAccess = async (startDownload = false) => {
    if (!commerce) {
      setAccessMessage("A cobrança ainda não está configurada nesta publicação.");
      setAccessOpen(true);
      return false;
    }
    setAccessBusy(true);
    try {
      const token = await commerce.accessToken();
      if (!token) {
        setAuthenticated(false);
        setAccessMessage("Entre ou crie sua conta para verificar o acesso.");
        setAccessOpen(true);
        return false;
      }
      setAuthenticated(true);
      const status = await commerce.billingStatus(token);
      const allowed = hasReleaseAccess(status);
      setReleaseReady(allowed);
      setAccessOpen(true);
      if (!allowed) {
        setAccessMessage("Acesso ainda não confirmado. Escolha um plano, conclua o checkout ou resgate um voucher.");
        return false;
      }
      setAccessMessage(status.trial.active
        ? `Trial ativo por mais ${status.trial.daysRemaining} dia${status.trial.daysRemaining === 1 ? "" : "s"}. Instalação liberada.`
        : `Plano ${status.plan.name} confirmado. Instalação liberada.`);
      if (status.access?.expiryWarning) setAccessMessage(`Seu acesso expira em ${status.access.daysRemaining} dias. Planeje a renovação.`);
      if (startDownload) openChromeStore(status.access?.installUrl);
      return true;
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "Não foi possível verificar o acesso.");
      setAccessOpen(true);
      return false;
    } finally {
      setAccessBusy(false);
    }
  };

  const requestDownload = () => {
    setPendingPlan("free");
    setVoucherCode("30DIAS");
    void verifyAccess(false);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = colorMode;
    window.localStorage.setItem("qtsTheme", theme);
    window.localStorage.setItem("qtsColorMode", colorMode);
  }, [theme, colorMode]);

  useEffect(() => { window.localStorage.setItem("qtsLocale", locale); document.documentElement.lang = locale; }, [locale]);

  useEffect(() => {
    if (!commerce) return;
    void commerce.promotionStatus().then(setLaunchPromotion).catch(() => setLaunchPromotion(null));
  }, []);

  const checkout = async (priceKey: PriceKey) => {
    if (!commerce) {
      setAccessMessage("A cobrança ainda não está configurada nesta publicação.");
      setAccessOpen(true);
      return;
    }
    setAccessBusy(true);
    setAccessMessage("");
    try {
      const token = await commerce.accessToken();
      if (!token) {
        setAuthenticated(false);
        setPendingPlan(priceKey);
        setAccessMessage("Entre ou crie sua conta para continuar ao checkout seguro.");
        setAccessOpen(true);
        return;
      }
      setAuthenticated(true);
      const url = await commerce.createCheckout(token, priceKey);
      window.location.assign(url);
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "Checkout indisponível.");
      setAccessOpen(true);
    } finally {
      setAccessBusy(false);
    }
  };

  const choosePlan = (priceKey: PriceKey) => {
    setPendingPlan(priceKey);
    setReleaseReady(false);
    void checkout(priceKey);
  };

  const authenticate = async () => {
    if (!commerce) return;
    if (!email.trim() || password.length < 10 || (authMode === "signup" && !acceptedTerms)) {
      setAccessMessage("Informe um e-mail, uma senha com ao menos 10 caracteres e aceite os termos.");
      return;
    }
    setAccessBusy(true);
    setAccessMessage("");
    try {
      if (authMode === "signup") {
        const result = await commerce.signUp(email.trim(), password, true);
        if ("confirmationRequired" in result) {
          setAccessMessage("Conta criada. Confirme o e-mail e depois entre para continuar.");
          setAuthMode("login");
          return;
        }
      } else {
        await commerce.signIn(email.trim(), password);
      }
      setAuthenticated(true);
      if (pendingPlan === "free") await verifyAccess(false);
      else await checkout(pendingPlan);
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "Não foi possível autenticar.");
    } finally {
      setAccessBusy(false);
    }
  };

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add("is-visible")),
      { threshold: 0.12 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!commerce) return;
    void commerce.accessToken().then((token) => setAuthenticated(Boolean(token))).catch(() => undefined);
    const query = new URLSearchParams(window.location.search);
    if (query.get("auth") === "confirmed") {
      setAuthMode("login");
      setAccessOpen(true);
      setAccessMessage("E-mail confirmado com sucesso. Entre com sua senha para continuar.");
      query.delete("auth");
      const cleanQuery = query.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}`);
      return;
    }
    if (query.get("checkout") === "cancel") {
      setAccessOpen(true);
      setAccessMessage("Checkout cancelado. Nenhuma cobrança foi confirmada.");
      return;
    }
    if (query.get("checkout") !== "success") return;
    setAccessOpen(true);
    setAccessMessage("Pagamento recebido. Aguardando a confirmação segura do Stripe...");
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void verifyAccess(false).then((allowed) => allowed && window.clearInterval(timer));
      if (attempts >= 15) window.clearInterval(timer);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="site-shell" ref={localizedRootRef}>
      <div className="aurora aurora-one" aria-hidden="true" />
      <div className="aurora aurora-two" aria-hidden="true" />
      <header className="nav-wrap">
        <nav className="nav container" aria-label="Navegação principal">
          <a className="brand" href="#inicio" aria-label="QA Toolbar Sandbox — início">
            <img className="brand-logo" src={brandLogo} alt="" />
            <span>QA Toolbar Sandbox</span>
          </a>
          <button className="menu-button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="Abrir menu">{menuOpen ? <FiX /> : <FiMenu />}</button>
          <div className={`nav-links ${menuOpen ? "is-open" : ""}`}>
            <a href="#recursos" onClick={() => setMenuOpen(false)}>{t("navigation.features")}</a>
            <a href="#planos" onClick={() => setMenuOpen(false)}>{t("common.plans")}</a>
            <a href="#seguranca" onClick={() => setMenuOpen(false)}>{t("navigation.security")}</a>
            <a href="#instalar" onClick={() => setMenuOpen(false)}>{t("navigation.install")}</a>
            <button className="button button-small" onClick={requestDownload}><FiLock /> Verificar acesso</button>
            <div className="theme-switcher" aria-label="Aparência">
              <select value={theme} onChange={(event) => setTheme(event.target.value as ThemeKey)} aria-label="Tema de cor">
                {themeCatalog.map((item) => <option value={item.key} key={item.key}>{item.name} · {item.meaning}</option>)}
              </select>
              <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label={t("common.language")}><option value="pt-BR">Português (Brasil)</option><option value="en">English</option><option value="es">Español</option></select>
              <button type="button" onClick={() => setColorMode((mode) => mode === "dark" ? "light" : "dark")} aria-label={`Ativar modo ${colorMode === "dark" ? "claro" : "escuro"}`} title={`Modo ${colorMode === "dark" ? "claro" : "escuro"}`}>
                {colorMode === "dark" ? <FiSun /> : <FiMoon />}
              </button>
            </div>
          </div>
        </nav>
      </header>

      <main>
        <section className="hero container" id="inicio">
          <div className="hero-copy is-visible" data-reveal>
            <div className="eyebrow"><span className="pulse-dot" /> Chrome Extension · local-first · Feito de QA para Todos!</div>
            <h1>{t("landing.heroTitle")}</h1>
            <p className="hero-lead">A QA Toolbar Sandbox aparece somente nas URLs que você autoriza e reúne projetos, ambientes, contas de teste, pagamentos sandbox, evidências e inspectors sem tirar você da página testada.</p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={requestDownload}><FiLock /> {t("landing.heroAction")} <FiArrowRight /></button>
              <a className="button button-ghost" href="#recursos"><FiMousePointer /> Ver como funciona</a>
            </div>
            <div className="micro-trust"><span><FiCheck /> Acesso verificado</span><span><FiLock /> Sem secrets no pacote</span><span><FiPackage /> 4 passos</span></div>
          </div>

          <div className="product-stage is-visible" data-reveal>
            <div className="browser-chrome">
              <div className="browser-top"><i /><i /><i /><div className="address"><FiLock /> localhost:3000/dashboard</div></div>
              <div className="browser-body">
                <div className="toolbar-preview">
                  <div className="toolbar-preview-brand"><span className="toolbar-preview-logo"><FiZap /></span><div><b>QA Toolbar Sandbox</b><small>PRONTO PARA TESTAR</small></div></div>
                  <div className="toolbar-preview-context"><small>PROJETO / AMBIENTE</small><b>Loja Demo <span>Stage</span></b></div>
                  <div className="toolbar-preview-status"><small>TEST STATUS</small><div><button className="is-pass">Pass</button><button>Fail</button><button>Blocked</button><button>Limitation</button></div></div>
                  <div className="toolbar-preview-tools"><button><FiUsers /><span>Contas</span></button><button><FiCreditCard /><span>Pagamentos</span></button><button><FiCamera /><span>Screenshot</span></button><button><FiActivity /><span>Gravar</span></button><button><FiEye /><span>Breakpoint</span></button><button><FiCode /><span>Tools</span></button></div>
                  <button className="toolbar-preview-menu"><FiMenu /> Menu</button>
                </div>
                <div className="mock-page is-blurred"><div className="mock-context"><small>PÁGINA EM TESTE</small><b>Checkout</b><span>Conteúdo desfocado para destacar a toolbar instalada</span></div><div className="mock-grid"><i /><i /><i /></div><div className="mock-chart"><b /><b /><b /><b /><b /><b /></div></div>
              </div>
            </div>
            <div className="stage-chip chip-a"><FiCheck /> Interface isolada</div><div className="stage-chip chip-b"><FiLock /> Local-first</div>
          </div>
        </section>

        <section className="trust-strip" aria-label="Características técnicas"><div className="container trust-inner"><span>Manifest V3</span><i /><span>React + TypeScript</span><i /><span>Shadow DOM</span><i /><span>Permissões sob demanda</span></div></section>

        <section className="section container" id="recursos">
          <div className="section-heading" data-reveal><span className="kicker">Como funciona</span><h2>Do primeiro clique à evidência final, sem sair do site.</h2><p>A toolbar reúne o fluxo do teste manual: contexto, status, inspeção, responsividade, captura e organização — sempre na página que você está validando.</p></div>
          <div className="feature-grid">{features.map(({ icon: Icon, title, text }, index) => <article className="feature-card" data-reveal style={{ "--delay": `${index * 55}ms` } as CSSProperties} key={title}><span className="feature-icon"><Icon /></span><h3>{title}</h3><p>{text}</p><span className="card-line" /></article>)}</div>
        </section>

        <section className="section security-section" id="seguranca">
          <div className="container security-grid">
            <div className="security-visual" data-reveal><div className="shield-orbit"><span className="orbit orbit-a" /><span className="orbit orbit-b" /><div className="shield-core"><FiShield /></div><i className="node n1" /><i className="node n2" /><i className="node n3" /></div></div>
            <div className="security-copy" data-reveal><span className="kicker">Privacidade sem letrinhas miúdas</span><h2>Você escolhe onde a extensão funciona e o que compartilhar.</h2><p>Seus projetos e evidências ficam no navegador por padrão. A extensão só atua nas URLs autorizadas por você, e uma conversão GIF externa acontece apenas após seu consentimento.</p><ul><li><FiCheck /> Permissão somente para os sites que você adicionar</li><li><FiCheck /> Projetos, contas sandbox e configurações locais por padrão</li><li><FiCheck /> Pagamentos processados diretamente pelo Stripe</li><li><FiCheck /> Chave Convertio fornecida e controlada por você</li></ul><a className="button button-ghost" href={privacyPolicyUrl}>Conhecer nossa Política de Privacidade <FiArrowRight /></a></div>
          </div>
        </section>

        <section className="section container install-section" id="instalar">
          <div className="section-heading" data-reveal><span className="kicker">Comece em quatro passos</span><h2>Da conta ao primeiro teste.</h2><p>Escolha o acesso que combina com seu momento e instale pela Chrome Web Store.</p></div>
          <div className="steps">{installSteps.map(([number, title, text]) => <article className="step" data-reveal key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
          <div className="manual-meme" data-reveal><img className="manual-gif" src="https://media.tenor.com/PPQdQblwtyAAAAAM/sabor-energ%C3%A9tico-sabor.gif" alt="Animação da campanha Testes manuais com sabooour automático" loading="lazy" referrerPolicy="no-referrer" /><div><span className="kicker">Testes manuais com sabooour automático</span><h3>Você mantém o olhar crítico. A toolbar tira o trabalho repetitivo do caminho.</h3><p>Menos tempo montando contexto, procurando conta sandbox e organizando evidência. Mais qualidade de vida, velocidade e foco para testar o que realmente importa.</p></div></div>
          <div className="install-callout" data-reveal><FiPackage /><div><b>Pronto para experimentar</b><p>Escolha um plano ou voucher, aguarde a validação e siga para a Chrome Web Store. <a className="hash-link" href={mockWorkspaceUrl} download>Baixar dados mock</a></p></div><a className="button button-primary" href="#planos"><FiLock /> Escolher acesso</a></div>
        </section>

        <section className="section container pricing-section" id="planos">
          <div className="section-heading" data-reveal><span className="kicker">Acesso antecipado</span><h2>{t("landing.plansTitle")}</h2></div>
          <div className="billing-toggle" role="group" aria-label="Periodicidade da cobrança">
            <button type="button" className={billingCycle === "monthly" ? "is-active" : ""} onClick={() => setBillingCycle("monthly")}>{t("landing.monthly")}</button>
            <button type="button" className={billingCycle === "yearly" ? "is-active" : ""} onClick={() => setBillingCycle("yearly")}>{t("landing.yearly")} <strong>até 25% OFF</strong></button>
          </div>
          <div className="pricing-grid pricing-three" data-reveal>
            <article className="price-card"><span>Starter</span><h3>Grátis</h3><p>30 dias de Full Access; depois, o essencial continua disponível.</p><ul><li><FiCheck /> 1 URL e 1 cliente após o trial</li><li><FiCheck /> Screenshot e status de teste</li><li><FiCheck /> Sem cartão no trial</li></ul><button className="button button-ghost" onClick={() => { setAuthMode("signup"); requestDownload(); }}>Escolher este plano</button></article>
            <article className="price-card featured"><span className="soon">Recomendado</span><span>Pro</span><h3>{planCatalog.pro[billingCycle].displayPrice} <small>/ mês</small></h3>{billingCycle === "yearly" && <p className="annual-detail">Cobrado {planCatalog.pro.yearly.billedPrice}/ano · economize {planCatalog.pro.yearly.discountPercent}%</p>}<p>Para profissionais e pequenos times que precisam manter ritmo.</p><ul><li><FiCheck /> 10 URLs e 25 clientes</li><li><FiCheck /> Gravação, anotações e inspectors</li><li><FiCheck /> {billingCycle === "yearly" ? "Maior desconto no compromisso anual" : "Cancele quando quiser"}</li></ul><button className="button button-primary" disabled={accessBusy} onClick={() => choosePlan(planCatalog.pro[billingCycle].priceKey)}>{accessBusy ? "Abrindo..." : "Escolher este plano"}</button></article>
            <article className="price-card"><span>Scale · Full Access</span><h3>{planCatalog.scale[billingCycle].displayPrice} <small>/ mês</small></h3>{billingCycle === "yearly" && <p className="annual-detail">Cobrado {planCatalog.scale.yearly.billedPrice}/ano · economize {planCatalog.scale.yearly.discountPercent}%</p>}<p>Para consultorias, operações e times em crescimento.</p><ul><li><FiCheck /> Escala sem limite prático</li><li><FiCheck /> HTTP Controls e histórico ampliado</li><li><FiCheck /> {billingCycle === "yearly" ? "Maior desconto no compromisso anual" : "Cancele quando quiser"}</li></ul><button className="button button-ghost" disabled={accessBusy} onClick={() => choosePlan(planCatalog.scale[billingCycle].priceKey)}>{accessBusy ? "Abrindo..." : "Escolher este plano"}</button></article>
          </div>
          {launchPromotion?.active && <div className="growth-offer" data-reveal><FiZap /><div><b>Oferta de lançamento: {launchPromotion.code}</b><p>{launchPromotion.percentOff}% de desconto para as primeiras {launchPromotion.maximumRedemptions} pessoas. Restam <strong>{launchPromotion.remainingRedemptions}</strong> vouchers — use o código no Stripe Checkout.</p></div></div>}
        </section>

        <section className="section container faq-section" id="faq"><div className="section-heading" data-reveal><span className="kicker">Perguntas frequentes</span><h2>Antes de instalar.</h2></div><div className="faq-list" data-reveal>{faqs.map(([question, answer], index) => <div className={`faq-item ${openFaq === index ? "is-open" : ""}`} key={question}><button onClick={() => setOpenFaq(openFaq === index ? -1 : index)} aria-expanded={openFaq === index}><span>{question}</span><FiChevronDown /></button><div className="faq-answer"><p>{answer}</p></div></div>)}</div></section>

        <section className="section container about-section" id="sobre"><div className="section-heading" data-reveal><span className="kicker">Sobre o produto</span><h2>Feita por QA, para quem testa de verdade.</h2><p>A QA Toolbar Sandbox é uma bancada local-first para reduzir tarefas repetitivas, organizar contextos e produzir evidências sem abandonar a aplicação validada.</p></div><div className="about-grid" data-reveal><article><h3>Propósito</h3><p>Dar clareza e velocidade ao trabalho manual sem substituir o julgamento da pessoa de QA.</p></article><article><h3>Privacidade</h3><p>Conta e acesso são processados pelo Supabase; pagamentos pelo Stripe. Dados operacionais permanecem locais por padrão.</p></article><article><h3>Desenvolvimento</h3><p>Produto criado por Matheus Bonotto, com suporte e evolução pública pelo repositório oficial.</p></article></div></section>

        <section className="final-cta"><div className="container" data-reveal><span className="kicker">Feito de QA para todos</span><h2>Seu teste manual pode ser muito mais fluido.</h2><p>Experimente 30 dias de Full Access, sem cartão, e descubra quanto tempo a toolbar devolve para o seu dia.</p><button className="button button-primary" onClick={requestDownload}><FiArrowRight /> Começar meus 30 dias</button></div></section>
      </main>

      {accessOpen && <div className="install-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAccessOpen(false)}>
        <section className="install-modal access-modal" role="dialog" aria-modal="true" aria-labelledby="access-title">
          <button className="modal-close" onClick={() => setAccessOpen(false)} aria-label="Fechar"><FiX /></button>
          <div className="modal-icon"><FiLock /></div>
          <span className="kicker">Acesso protegido</span>
          <h2 id="access-title">{authenticated ? "Seu acesso à extensão" : "Entre para continuar"}</h2>
          {accessMessage && <p className={`access-message ${releaseReady ? "is-success" : ""}`}>{accessMessage}</p>}
          {!authenticated ? <>
            <div className="auth-switch"><button className={authMode === "login" ? "is-active" : ""} onClick={() => setAuthMode("login")}>Entrar</button><button className={authMode === "signup" ? "is-active" : ""} onClick={() => setAuthMode("signup")}>Criar conta</button></div>
            <div className="auth-fields"><label>E-mail<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Senha<input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{authMode === "signup" && <><p className="privacy-disclosure">Para criar a conta, enviamos e-mail, aceite, identificador da instalação e dados do plano ao Supabase. Pagamentos são processados pelo Stripe. Projetos, ambientes e URLs ficam no navegador por padrão.</p><label className="terms-check"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>Li e aceito a <a href={privacyPolicyUrl} target="_blank" rel="noreferrer">Política de Privacidade</a>.</span></label></>}</div>
            <button className="button button-primary access-primary" disabled={accessBusy} onClick={() => void authenticate()}>{accessBusy ? "Aguarde..." : pendingPlan === "free" ? (authMode === "signup" ? "Criar conta e liberar trial" : "Entrar e verificar acesso") : "Continuar para o checkout"}</button>
          </> : <><div className="voucher-entry"><label htmlFor="voucher">Tem um voucher?</label><div><input id="voucher" value={voucherCode} onChange={(event) => setVoucherCode(event.target.value.toUpperCase())} placeholder="Digite seu código" /><button className="button button-ghost" disabled={accessBusy || voucherCode.trim().length < 6} onClick={() => void redeemVoucher()}>Resgatar</button></div></div><div className="modal-actions">
            {pendingPlan !== "free" ? <button className="button button-primary" disabled={accessBusy} onClick={() => void checkout(pendingPlan)}>{accessBusy ? "Abrindo..." : "Escolher este plano"} <FiArrowRight /></button> : releaseReady ? <button className="button button-primary" disabled={accessBusy} onClick={() => openChromeStore()}><FiDownload /> Ir para Chrome Store</button> : <button className="button button-primary" disabled={accessBusy || voucherCode.trim().length < 6} onClick={() => void redeemVoucher()}>{accessBusy ? "Liberando..." : "Ativar meus 30 dias"}</button>}
            <a className="button button-ghost" href="#planos" onClick={() => setAccessOpen(false)}>Escolher outro plano</a>
            <button className="button button-ghost" disabled={accessBusy} onClick={() => void verifyAccess(false)}>{accessBusy ? "Verificando..." : "Verificar meu acesso"}</button>
            <button className="button button-ghost" onClick={() => { commerce?.signOut(); setAuthenticated(false); setReleaseReady(false); }}>Sair</button>
          </div></>}
          <small>A liberação é decidida pelo backend após confirmar pagamento, trial ou voucher válido. O retorno do checkout, sozinho, não desbloqueia a instalação.</small>
        </section>
      </div>}

      <a className="creator-corner" href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer" aria-label="Site de Matheus Bonotto"><img src={`${import.meta.env.BASE_URL}matheus-bonotto-icon.png`} alt="" /><span>Matheus Bonotto</span></a>
      <footer><div className="container footer-inner"><a className="brand" href="#inicio"><img className="brand-logo" src={brandLogo} alt="" /><span>QA Toolbar Sandbox</span></a><p className="footer-credit">Feito de QA para Todos! · Desenvolvido por <a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer"><img src={`${import.meta.env.BASE_URL}matheus-bonotto-icon.png`} alt="Ícone de Matheus Bonotto" /> Matheus Bonotto</a></p><div><a href="#sobre">Sobre</a><a href="#faq">FAQ</a><a href="#seguranca">Segurança</a><a href={privacyPolicyUrl}>Privacidade</a><a href="#instalar">Instalação</a></div></div></footer>
    </div>
  );
}
