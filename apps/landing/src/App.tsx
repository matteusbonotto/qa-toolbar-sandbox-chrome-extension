import { useEffect, useState, type CSSProperties } from "react";
import { monthlyPlanCatalog } from "@qts/domain";
import {
  FiActivity, FiArrowRight, FiCheck, FiChevronDown, FiCode, FiCpu,
  FiDownload, FiEye, FiGitBranch, FiHardDrive, FiLayers, FiLock,
  FiMenu, FiMousePointer, FiPackage, FiShield, FiSliders, FiX, FiZap,
} from "react-icons/fi";
import logoWhite from "./assets/images/logo-branco.png";
import { createLandingCommerce, hasReleaseAccess, type PriceKey } from "./services/commerce";

const checksumUrl = `${import.meta.env.BASE_URL}downloads/qa-toolbar-sandbox-chrome.zip.sha256`;
const mockWorkspaceUrl = `${import.meta.env.BASE_URL}downloads/qa-toolbar-demo-workspace.json`;
const privacyPolicyUrl = `${import.meta.env.BASE_URL}privacy-policy/`;
const commerce = createLandingCommerce();

const features = [
  { icon: FiEye, title: "Inspecione no contexto", text: "Enxergue estados, medidas e sinais da interface sem abandonar a página em teste." },
  { icon: FiSliders, title: "Seu workspace de QA", text: "Ferramentas organizadas em uma barra leve, recolhível e sem poluir sua aplicação." },
  { icon: FiHardDrive, title: "Local-first", text: "Configurações e dados operacionais ficam no navegador por padrão. Você controla o que sai dele." },
  { icon: FiGitBranch, title: "Fluxos reproduzíveis", text: "Transforme observações soltas em um processo mais consistente para investigar e reportar." },
  { icon: FiCode, title: "Feita para ambientes reais", text: "Uma base extensível para localhost, homologação e, com permissão explícita, outros domínios." },
  { icon: FiShield, title: "Defesa em profundidade", text: "Manifest V3, permissões mínimas, isolamento visual e backend protegido por autenticação e RLS." },
];

const installSteps = [
  ["01", "Baixe e extraia", "Baixe o ZIP e extraia todo o conteúdo para uma pasta permanente."],
  ["02", "Abra as extensões", "Acesse chrome://extensions e ative o Modo do desenvolvedor."],
  ["03", "Carregue a pasta", "Clique em Carregar sem compactação e selecione a pasta que contém manifest.json."],
  ["04", "Fixe e experimente", "Fixe a extensão e abra uma página local para testar a versão atual."],
];

const faqs = [
  ["Por que a instalação é manual?", "A distribuição direta evita a taxa da Chrome Web Store. O Chrome exige o Modo do desenvolvedor e uma pasta extraída para extensões distribuídas assim."],
  ["O ZIP vai em “Carregar sem compactação”?", "Não. Primeiro extraia o ZIP; depois selecione a pasta extraída que contém o arquivo manifest.json."],
  ["A extensão se atualiza sozinha?", "Não nesta forma de distribuição. Novas versões precisam ser baixadas e substituir a pasta anterior."],
  ["Quais sites funcionam agora?", "Este Early Access está habilitado para localhost e 127.0.0.1. Outros domínios serão liberados com consentimento explícito por site."],
  ["Como o download é liberado?", "Você entra na sua conta, escolhe um plano mensal e conclui o Stripe Checkout. O ZIP só é iniciado depois que o webhook confirma uma cobrança paga e a assinatura ativa."],
];

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [installOpen, setInstallOpen] = useState(false);
  const [copied, setCopied] = useState(false);
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

  const downloadRelease = async () => {
    if (!commerce) return;
    setAccessBusy(true);
    try {
      const token = await commerce.accessToken();
      if (!token) throw new Error("Entre na sua conta para baixar.");
      const downloadUrl = await commerce.releaseUrl(token);
      const download = document.createElement("a");
      download.href = downloadUrl;
      download.rel = "noreferrer";
      document.body.append(download);
      download.click();
      download.remove();
      setAccessOpen(false);
      setInstallOpen(true);
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "Download indisponível.");
      setAccessOpen(true);
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
        setAccessMessage("Pagamento ainda não confirmado pelo Stripe. Escolha um plano e conclua o checkout para liberar o download.");
        return false;
      }
      setAccessMessage(status.trial.active
        ? `Trial ativo por mais ${status.trial.daysRemaining} dia${status.trial.daysRemaining === 1 ? "" : "s"}. Download liberado.`
        : `Plano ${status.plan.name} confirmado. Download liberado.`);
      if (startDownload) await downloadRelease();
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
    void verifyAccess(true);
  };

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
      if (pendingPlan === "free") await verifyAccess(true);
      else await checkout(pendingPlan);
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "Não foi possível autenticar.");
    } finally {
      setAccessBusy(false);
    }
  };

  const copyExtensionsUrl = async () => {
    await navigator.clipboard.writeText("chrome://extensions");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
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

  useEffect(() => {
    if (!installOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setInstallOpen(false);
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [installOpen]);

  return (
    <div className="site-shell">
      <div className="aurora aurora-one" aria-hidden="true" />
      <div className="aurora aurora-two" aria-hidden="true" />
      <header className="nav-wrap">
        <nav className="nav container" aria-label="Navegação principal">
          <a className="brand" href="#inicio" aria-label="QA Toolbar Sandbox — início">
            <img className="brand-logo" src={logoWhite} alt="QA Sandbox Toolbar" />
          </a>
          <button className="menu-button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="Abrir menu">{menuOpen ? <FiX /> : <FiMenu />}</button>
          <div className={`nav-links ${menuOpen ? "is-open" : ""}`}>
            <a href="#recursos" onClick={() => setMenuOpen(false)}>Recursos</a>
            <a href="#planos" onClick={() => setMenuOpen(false)}>Planos</a>
            <a href="#seguranca" onClick={() => setMenuOpen(false)}>Segurança</a>
            <a href="#instalar" onClick={() => setMenuOpen(false)}>Como instalar</a>
            <button className="button button-small" onClick={requestDownload}><FiLock /> Verificar acesso</button>
          </div>
        </nav>
      </header>

      <main>
        <section className="hero container" id="inicio">
          <div className="hero-copy" data-reveal>
            <div className="eyebrow"><span className="pulse-dot" /> Early Access · v0.1.2 · Feito de QA para Todos!</div>
            <h1>Seu laboratório de QA, <span>direto no navegador.</span></h1>
            <p className="hero-lead">Investigue interfaces com mais contexto e menos troca de ferramenta. Uma toolbar rápida, organizada e construída para evoluir com o seu fluxo. Feito de QA para QA — ou melhor, de QA para Todos!</p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={requestDownload}><FiLock /> Verificar acesso + baixar <FiArrowRight /></button>
              <a className="button button-ghost" href="#instalar"><FiMousePointer /> Ver instalação</a>
            </div>
            <div className="micro-trust"><span><FiCheck /> Acesso verificado</span><span><FiLock /> Sem secrets no pacote</span><span><FiPackage /> 4 passos</span></div>
          </div>

          <div className="product-stage" data-reveal>
            <div className="browser-chrome">
              <div className="browser-top"><i /><i /><i /><div className="address"><FiLock /> localhost:3000/dashboard</div></div>
              <div className="browser-body">
                <div className="mock-sidebar"><span className="mock-logo" /><span /><span /><span /><span /></div>
                <div className="mock-page"><div className="mock-title" /><div className="mock-grid"><i /><i /><i /></div><div className="mock-chart"><b /><b /><b /><b /><b /><b /></div></div>
                <div className="floating-toolbar">
                  <div className="toolbar-head"><span><FiZap /> QA Toolbar</span><small>Sandbox</small></div>
                  <div className="toolbar-metrics"><span><b>12</b> checks</span><span><b>0</b> issues</span><span><b>42ms</b> UI</span></div>
                  <div className="toolbar-actions"><button><FiActivity /> Observe</button><button><FiCpu /> Analyze</button><button><FiCode /> Inspect</button></div>
                  <div className="scan-line" />
                </div>
              </div>
            </div>
            <div className="stage-chip chip-a"><FiCheck /> Interface isolada</div><div className="stage-chip chip-b"><FiLock /> Local-first</div>
          </div>
        </section>

        <section className="trust-strip" aria-label="Características técnicas"><div className="container trust-inner"><span>Manifest V3</span><i /><span>React + TypeScript</span><i /><span>Shadow DOM</span><i /><span>Permissões sob demanda</span></div></section>

        <section className="section container" id="recursos">
          <div className="section-heading" data-reveal><span className="kicker">Uma camada de foco</span><h2>As ferramentas certas, onde o problema acontece.</h2><p>A primeira versão estabelece uma base segura e modular para concentrar a investigação no próprio produto.</p></div>
          <div className="feature-grid">{features.map(({ icon: Icon, title, text }, index) => <article className="feature-card" data-reveal style={{ "--delay": `${index * 55}ms` } as CSSProperties} key={title}><span className="feature-icon"><Icon /></span><h3>{title}</h3><p>{text}</p><span className="card-line" /></article>)}</div>
        </section>

        <section className="section security-section" id="seguranca">
          <div className="container security-grid">
            <div className="security-visual" data-reveal><div className="shield-orbit"><span className="orbit orbit-a" /><span className="orbit orbit-b" /><div className="shield-core"><FiShield /></div><i className="node n1" /><i className="node n2" /><i className="node n3" /></div></div>
            <div className="security-copy" data-reveal><span className="kicker">Segurança desde a base</span><h2>Seu navegador não deveria confiar às cegas.</h2><p>O projeto reduz privilégios no cliente e mantém decisões de cobrança, papéis e licenças no servidor.</p><ul><li><FiCheck /> Nenhuma chave Stripe ou service-role no bundle</li><li><FiCheck /> RLS e acesso negado por padrão nas tabelas sensíveis</li><li><FiCheck /> Webhooks assinados, idempotência e rate limiting</li><li><FiCheck /> Novos domínios somente com sua permissão</li></ul><small>Segurança é um processo contínuo; nenhuma aplicação pode prometer risco zero.</small></div>
          </div>
        </section>

        <section className="section container install-section" id="instalar">
          <div className="section-heading" data-reveal><span className="kicker">Instalação direta</span><h2>Do download ao primeiro teste em minutos.</h2><p>Sem loja e sem instalador opaco: você pode inspecionar a pasta e removê-la quando quiser.</p></div>
          <div className="steps">{installSteps.map(([number, title, text]) => <article className="step" data-reveal key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
          <div className="install-callout" data-reveal><FiPackage /><div><b>Importante</b><p>O download é iniciado somente após o webhook confirmar uma cobrança paga no Stripe e uma assinatura ativa. Depois, extraia o ZIP e escolha a pasta em que o <code>manifest.json</code> aparece na raiz. <a className="hash-link" href={checksumUrl} download>Ver SHA-256</a> · <a className="hash-link" href={mockWorkspaceUrl} download>Baixar dados mock</a></p></div><a className="button button-primary" href="#planos"><FiLock /> Escolher plano</a></div>
        </section>

        <section className="section container pricing-section" id="planos">
          <div className="section-heading" data-reveal><span className="kicker">Acesso antecipado</span><h2>Comece livre. Evolua quando fizer sentido.</h2></div>
          <div className="pricing-grid pricing-three" data-reveal>
            <article className="price-card"><span>Starter</span><h3>Grátis</h3><p>30 dias de Full Access; depois, o essencial continua disponível.</p><ul><li><FiCheck /> 1 domínio e 1 cliente</li><li><FiCheck /> Screenshot e Pass/Fail</li><li><FiCheck /> Sem cartão no trial</li></ul><button className="button button-ghost" onClick={() => { setAuthMode("signup"); requestDownload(); }}>Começar 30 dias</button></article>
            <article className="price-card featured"><span className="soon">Recomendado</span><span>Pro</span><h3>{monthlyPlanCatalog.pro.displayPrice} <small>/ mês</small></h3><p>Para profissionais e pequenos times que precisam manter ritmo.</p><ul><li><FiCheck /> 10 domínios e 25 clientes</li><li><FiCheck /> Gravação, anotações e inspectors</li><li><FiCheck /> Cobrança mensal, sem compromisso anual</li></ul><button className="button button-primary" disabled={accessBusy} onClick={() => choosePlan(monthlyPlanCatalog.pro.priceKey)}>{accessBusy ? "Abrindo..." : "Contratar Pro mensal"}</button></article>
            <article className="price-card"><span>Scale · Full Access</span><h3>{monthlyPlanCatalog.scale.displayPrice} <small>/ mês</small></h3><p>Para consultorias, operações e times em crescimento.</p><ul><li><FiCheck /> Escala sem limite prático</li><li><FiCheck /> HTTP Controls e histórico ampliado</li><li><FiCheck /> Cobrança mensal, cancele quando quiser</li></ul><button className="button button-ghost" disabled={accessBusy} onClick={() => choosePlan(monthlyPlanCatalog.scale.priceKey)}>{accessBusy ? "Abrindo..." : "Contratar Scale mensal"}</button></article>
          </div>
          <div className="growth-offer" data-reveal><FiZap /><div><b>Oferta de lançamento: COMECE30</b><p>30% nos três primeiros meses. Indicações dão 20% ao novo cliente e crédito ao indicador após a primeira cobrança.</p></div></div>
        </section>

        <section className="section container faq-section"><div className="section-heading" data-reveal><span className="kicker">Perguntas frequentes</span><h2>Antes de instalar.</h2></div><div className="faq-list" data-reveal>{faqs.map(([question, answer], index) => <div className={`faq-item ${openFaq === index ? "is-open" : ""}`} key={question}><button onClick={() => setOpenFaq(openFaq === index ? -1 : index)} aria-expanded={openFaq === index}><span>{question}</span><FiChevronDown /></button><div className="faq-answer"><p>{answer}</p></div></div>)}</div></section>

        <section className="final-cta"><div className="container" data-reveal><span className="kicker">Pronto para explorar?</span><h2>Menos troca de contexto.<br />Mais clareza para testar.</h2><p>Entre, confirme seu acesso e instale a versão Early Access.</p><button className="button button-primary" onClick={requestDownload}><FiLock /> Confirmar acesso + baixar <FiArrowRight /></button></div></section>
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
            <div className="auth-fields"><label>E-mail<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Senha<input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{authMode === "signup" && <><p className="privacy-disclosure">Para criar a conta, enviamos e-mail, aceite, identificador da instalação e dados do plano ao Supabase. Pagamentos são processados pelo Stripe. Projetos, ambientes e domínios ficam no navegador por padrão.</p><label className="terms-check"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>Li e aceito a <a href={privacyPolicyUrl} target="_blank" rel="noreferrer">Política de Privacidade</a>.</span></label></>}</div>
            <button className="button button-primary access-primary" disabled={accessBusy} onClick={() => void authenticate()}>{accessBusy ? "Aguarde..." : pendingPlan === "free" ? (authMode === "signup" ? "Criar conta e liberar trial" : "Entrar e verificar acesso") : "Continuar para o checkout"}</button>
          </> : <div className="modal-actions">
            {pendingPlan !== "free" ? <button className="button button-primary" disabled={accessBusy} onClick={() => void checkout(pendingPlan)}>{accessBusy ? "Abrindo..." : "Ir para o checkout"} <FiArrowRight /></button> : releaseReady ? <button className="button button-primary" disabled={accessBusy} onClick={() => void downloadRelease()}><FiDownload /> {accessBusy ? "Preparando..." : "Baixar extensão"}</button> : <a className="button button-primary" href="#planos" onClick={() => setAccessOpen(false)}>Escolher um plano pago</a>}
            <button className="button button-ghost" disabled={accessBusy} onClick={() => void verifyAccess(false)}>{accessBusy ? "Verificando..." : "Atualizar pagamento"}</button>
            <button className="button button-ghost" onClick={() => { commerce?.signOut(); setAuthenticated(false); setReleaseReady(false); }}>Sair</button>
          </div>}
          <small>A liberação é decidida pelo backend após o webhook confirmar uma cobrança Stripe paga. O retorno do checkout, sozinho, não desbloqueia o download.</small>
        </section>
      </div>}

      {installOpen && <div className="install-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setInstallOpen(false)}>
        <section className="install-modal" role="dialog" aria-modal="true" aria-labelledby="install-title">
          <button className="modal-close" onClick={() => setInstallOpen(false)} aria-label="Fechar guia"><FiX /></button>
          <div className="modal-icon"><FiDownload /></div>
          <span className="kicker">Download iniciado</span>
          <h2 id="install-title">Agora conclua a instalação no Chrome</h2>
          <p className="modal-lead">O Chrome no Windows bloqueia instalação automática fora da Web Store. O ZIP foi baixado; faltam estes passos manuais:</p>
          <ol className="modal-steps">
            <li><b>1</b><span><strong>Extraia o ZIP</strong>Abra Downloads, clique com o botão direito no arquivo e escolha “Extrair tudo”.</span></li>
            <li><b>2</b><span><strong>Abra as extensões</strong>Copie <code>chrome://extensions</code>, cole na barra do Chrome e pressione Enter.</span></li>
            <li><b>3</b><span><strong>Ative o modo do desenvolvedor</strong>Use a chave localizada no canto superior direito da tela.</span></li>
            <li><b>4</b><span><strong>Carregue a pasta extraída</strong>Clique em “Carregar sem compactação” e escolha a pasta que contém <code>manifest.json</code>.</span></li>
          </ol>
          <div className="modal-actions">
            <button className="button button-primary" onClick={() => void copyExtensionsUrl()}><FiLayers /> {copied ? "Endereço copiado!" : "Copiar chrome://extensions"}</button>
            <button className="button button-ghost" onClick={requestDownload}><FiDownload /> Baixar novamente</button>
          </div>
          <small>Não existe um botão web legítimo que ignore essa confirmação no Chrome para Windows.</small>
        </section>
      </div>}

      <a className="creator-corner" href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer" aria-label="Site de Matheus Bonotto"><img src={`${import.meta.env.BASE_URL}matheus-bonotto-icon.png`} alt="" /><span>Matheus Bonotto</span></a>
      <footer><div className="container footer-inner"><a className="brand" href="#inicio"><img className="brand-logo" src={logoWhite} alt="QA Sandbox Toolbar" /></a><p className="footer-credit">Feito de QA para Todos! · Desenvolvido por <a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer"><img src={`${import.meta.env.BASE_URL}matheus-bonotto-icon.png`} alt="Ícone de Matheus Bonotto" /> Matheus Bonotto</a></p><div><a href="#seguranca">Segurança</a><a href={privacyPolicyUrl}>Privacidade</a><a href="#instalar">Instalação</a></div></div></footer>
    </div>
  );
}
