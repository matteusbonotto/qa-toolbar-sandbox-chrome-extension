import { useEffect, useState } from "react";
import { FiCheck, FiCreditCard, FiExternalLink, FiGift, FiGlobe, FiLock, FiLogOut, FiSettings, FiStar, FiUser, FiZap } from "react-icons/fi";
import { createAuthApi, createBillingApi } from "../services/runtimeConfig";
import { refreshEntitlements, type EntitlementCache } from "../services/entitlements";

type Tab = "setup" | "plans" | "account";
type BillingCycle = "monthly" | "yearly";
type PlanCard = {
  key: "free" | "pro" | "scale";
  name: string;
  price: string | Record<BillingCycle, string>;
  note: string;
  recommended?: boolean;
  features: readonly string[];
};
const plans: readonly PlanCard[] = [
  { key: "free", name: "Starter", price: "Grátis", note: "após 30 dias de Full Access", features: ["1 domínio e 1 cliente", "Screenshot", "Marcadores Pass e Fail", "Configuração local"] },
  { key: "pro", name: "Pro", price: { monthly: "R$ 29,90", yearly: "R$ 299" }, note: "para profissionais e pequenos times", recommended: true, features: ["10 domínios e 25 clientes", "Gravação e anotações", "Inspectors e JSON Diff", "Exportação completa"] },
  { key: "scale", name: "Scale", price: { monthly: "R$ 59,90", yearly: "R$ 599" }, note: "Full Access para operações que escalam", features: ["Domínios e clientes sem limite prático", "HTTP Controls avançados", "Histórico ampliado", "Prioridade em novidades"] },
];

export function PopupApp() {
  const [tab, setTab] = useState<Tab>("setup");
  const [cycle, setCycle] = useState<BillingCycle>("yearly");
  const [projectName, setProjectName] = useState("Meu projeto QA");
  const [domain, setDomain] = useState("localhost");
  const [environmentName, setEnvironmentName] = useState("Local");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [entitlements, setEntitlements] = useState<EntitlementCache | null>(null);
  const logoUrl = typeof browser !== "undefined" ? browser.runtime.getURL("/qa-sandbox-logo.svg") : "/qa-sandbox-logo.svg";

  useEffect(() => {
    void browser.storage.local.get("qtsSetup").then(({ qtsSetup }) => {
      const setup = qtsSetup as { projectName?: string; domain?: string; domains?: string[]; environmentName?: string } | undefined;
      if (setup?.projectName) setProjectName(setup.projectName);
      if (setup?.domains?.length) setDomain(setup.domains.join(", "));
      else if (setup?.domain) setDomain(setup.domain);
      if (setup?.environmentName) setEnvironmentName(setup.environmentName);
    });
    try {
      void createAuthApi().accessToken().then(async (token) => {
        setSignedIn(Boolean(token));
        if (token) setEntitlements(await refreshEntitlements(token));
      }).catch(() => undefined);
    } catch { /* shown when used */ }
  }, []);

  const saveSetup = async () => {
    const domains = [...new Set(domain.split(/[\s,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean))];
    const maximum = Number(entitlements?.features["domains.maximum"] ?? 1);
    if (projectName.trim().length < 2 || !domains.length || domains.some((value) => !/^(localhost|(?:[a-z0-9-]+\.)*[a-z0-9-]+)$/i.test(value))) {
      setMessage("Revise o nome e informe os domínios sem https:// ou caminhos."); return;
    }
    if (domains.length > maximum) { setMessage(`Seu plano permite ${maximum} domínio${maximum === 1 ? "" : "s"}. Remova itens ou faça upgrade.`); return; }
    const origins = domains.filter((value) => value !== "localhost" && value !== "127.0.0.1").map((value) => `*://${value}/*`);
    if (origins.length && !await browser.permissions.request({ origins })) { setMessage("Permissão de domínio não concedida. Nada foi alterado."); return; }
    const registered = await browser.scripting.getRegisteredContentScripts();
    const oldIds = registered.filter((item) => item.id.startsWith("qts-domain-")).map((item) => item.id);
    if (oldIds.length) await browser.scripting.unregisterContentScripts({ ids: oldIds });
    if (origins.length) await browser.scripting.registerContentScripts(origins.map((origin, index) => ({
      id: `qts-domain-${index}`,
      matches: [origin],
      js: ["content-scripts/content.js"],
      persistAcrossSessions: true,
      runAt: "document_idle",
    })));
    await browser.storage.local.set({ qtsSetup: { projectName: projectName.trim(), domain: domains[0], domains, environmentName: environmentName.trim() || "Local" } });
    setMessage("Configuração salva. Recarregue as abas autorizadas para exibir a toolbar.");
  };

  const authenticate = async () => {
    setBusy(true); setMessage("");
    try {
      const auth = createAuthApi();
      if (mode === "signup") {
        if (!acceptedTerms) throw new Error("Aceite os termos e a política de privacidade para continuar.");
        const result = await auth.signUp(email, password, true, referralCode.trim().toUpperCase() || undefined);
        if ("confirmationRequired" in result) { setMessage("Conta criada. Confirme o e-mail e depois faça login."); setMode("login"); return; }
      } else await auth.signIn(email, password);
      setSignedIn(true);
      const token = await auth.accessToken();
      if (token) setEntitlements(await refreshEntitlements(token));
      setMessage("Conta conectada. Seu acesso e limites foram sincronizados."); setTab("plans");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível autenticar."); }
    finally { setBusy(false); }
  };

  const checkout = async (plan: PlanCard["key"]) => {
    if (plan === "free") {
      setTab("account");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const token = await createAuthApi().accessToken();
      if (!token) { setTab("account"); setMessage("Crie sua conta ou entre antes de contratar."); return; }
      const priceKey = `${plan}_${cycle}` as "pro_monthly" | "pro_yearly" | "scale_monthly" | "scale_yearly";
      const url = await createBillingApi().createCheckout(token, priceKey, referralCode.trim().toUpperCase() || undefined);
      await browser.tabs.create({ url });
    } catch (error) { setMessage(error instanceof Error ? `${error.message}. O backend de cobrança precisa estar publicado.` : "Checkout indisponível."); }
    finally { setBusy(false); }
  };

  const portal = async () => {
    setBusy(true);
    try { const token = await createAuthApi().accessToken(); if (!token) throw new Error("Faça login primeiro"); await browser.tabs.create({ url: await createBillingApi().createCustomerPortal(token) }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Portal indisponível"); } finally { setBusy(false); }
  };

  return <main className="qtsControlCenter">
    <aside className="qtsControlNav">
      <img src={logoUrl} alt="QA Sandbox Toolbar" />
      <nav><button className={tab === "setup" ? "isActive" : ""} onClick={() => setTab("setup")}><FiSettings /> Configuração</button><button className={tab === "plans" ? "isActive" : ""} onClick={() => setTab("plans")}><FiStar /> Planos</button><button className={tab === "account" ? "isActive" : ""} onClick={() => setTab("account")}><FiUser /> Minha conta</button></nav>
      <div className="qtsTrialBadge"><FiGift /><span><b>30 dias Full Access</b><small>Sem cartão · downgrade seguro</small></span></div>
    </aside>
    <section className="qtsControlContent">
      <header><div><small>QA SANDBOX TOOLBAR</small><h1>{tab === "setup" ? "Deixe tudo pronto para testar" : tab === "plans" ? "Escolha o ritmo da sua operação" : "Conta e benefícios"}</h1></div><span className="qtsConnection"><i /> {entitlements ? `${entitlements.plan.name}${entitlements.trial.active ? ` · ${entitlements.trial.daysRemaining} dias` : ""}` : signedIn ? "Sincronizando" : "Modo Starter"}</span></header>
      {message && <div className="qtsControlMessage">{message}</div>}

      {tab === "setup" && <div className="qtsSetupFlow"><div className="qtsStepHead"><b>1</b><span><strong>Contexto da toolbar</strong><small>Você poderá alterar isso quando quiser.</small></span></div><div className="qtsControlGrid"><label>Nome do projeto<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><label>Ambiente<input value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} /></label><label className="isWide">Domínios <small>separe por vírgula · limite atual: {Number(entitlements?.features["domains.maximum"] ?? 1)}</small><div><FiGlobe /><input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="app.exemplo.com, staging.exemplo.com" /></div></label></div><div className="qtsSetupHint"><FiLock /><span><b>Permissão somente sob demanda</b><small>A extensão solicita acesso apenas aos domínios que você salvar.</small></span></div><button className="qtsPrimary" onClick={() => void saveSetup()}><FiCheck /> Salvar e ativar toolbar</button></div>}

      {tab === "plans" && <><div className="qtsCycle"><button className={cycle === "monthly" ? "isActive" : ""} onClick={() => setCycle("monthly")}>Mensal</button><button className={cycle === "yearly" ? "isActive" : ""} onClick={() => setCycle("yearly")}>Anual <span>2 meses grátis</span></button></div><div className="qtsPlanGrid">{plans.map((plan) => <article className={plan.recommended ? "isRecommended" : ""} key={plan.key}>{plan.recommended && <em><FiStar /> Recomendado</em>}<h2>{plan.name}</h2><p>{plan.note}</p><strong>{typeof plan.price === "string" ? plan.price : plan.price[cycle]} {typeof plan.price !== "string" && <small>/{cycle === "monthly" ? "mês" : "ano"}</small>}</strong><ul>{plan.features.map((feature) => <li key={feature}><FiCheck /> {feature}</li>)}</ul>{plan.key === "free" ? <button onClick={() => setTab("account")}>Começar trial grátis</button> : <button className="qtsPrimary" disabled={busy} onClick={() => void checkout(plan.key)}>{busy ? "Abrindo..." : `Escolher ${plan.name}`} <FiExternalLink /></button>}</article>)}</div><div className="qtsPromo"><FiGift /><span><b>Lançamento: COMECE30</b><small>30% de desconto nos três primeiros meses. O checkout também aceita códigos de indicação.</small></span></div></>}

      {tab === "account" && <div className="qtsAccountLayout"><section><div className="qtsAuthSwitch"><button className={mode === "signup" ? "isActive" : ""} onClick={() => setMode("signup")}>Criar conta</button><button className={mode === "login" ? "isActive" : ""} onClick={() => setMode("login")}>Entrar</button></div><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "Mínimo de 10 caracteres" : "Sua senha"} /></label>{mode === "signup" && <><label>Código de indicação <small>opcional</small><input value={referralCode} onChange={(event) => setReferralCode(event.target.value.toUpperCase())} placeholder="QTS-XXXXXXXX" /></label><label className="qtsTerms"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>Li e aceito os termos e a política de privacidade.</span></label></>}<button className="qtsPrimary" disabled={busy} onClick={() => void authenticate()}>{busy ? "Aguarde..." : mode === "signup" ? "Criar conta e ativar 30 dias" : "Entrar na minha conta"}</button></section><aside><FiZap /><h2>Indique e ganhe</h2><p>Seu indicado recebe 20% por três meses. Após a primeira cobrança confirmada, você recebe crédito equivalente a um mês Pro.</p><div><FiCreditCard /> Crédito aplicado na próxima fatura</div>{signedIn && <><button onClick={() => void portal()}>Gerenciar assinatura <FiExternalLink /></button><button className="qtsSignOut" onClick={() => void createAuthApi().signOut().then(() => setSignedIn(false))}><FiLogOut /> Sair</button></>}</aside></div>}
    </section>
  </main>;
}
