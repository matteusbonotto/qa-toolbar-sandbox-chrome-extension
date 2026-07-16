import { useEffect, useRef, useState } from "react";
import { isLocale, isThemeKey, localizeDom, planCatalog, themeCatalog, translate, type BillingCycle, type ColorMode, type Locale, type PriceKey, type ThemeKey } from "@qts/domain";
import { FiCheck, FiCreditCard, FiExternalLink, FiGift, FiHelpCircle, FiInfo, FiLogOut, FiMonitor, FiMoon, FiSettings, FiShield, FiStar, FiSun, FiUser, FiZap } from "react-icons/fi";
import { createAuthApi, createBillingApi } from "../services/runtimeConfig";
import { refreshEntitlements, type EntitlementCache } from "../services/entitlements";
import { SetupWizard } from "./SetupWizard";
import { LocalDataManager } from "./LocalDataManager";
import { ConvertioSettings } from "./ConvertioSettings";
import { BreakpointViewer } from "./BreakpointViewer";
import { HelpCenter } from "./HelpCenter";
import { WorkspaceManager } from "./WorkspaceManager";
import { authorizeExtensionSurface } from "../services/accessGate";

type Tab = "setup" | "workspace" | "plans" | "account" | "data" | "convertio" | "breakpoints" | "faq" | "about";
const protectedTabs = new Set<Tab>(["setup", "workspace", "data", "convertio", "breakpoints"]);
type PlanCard = {
  key: "free" | "pro" | "scale";
  name: string;
  price: string;
  prices?: Record<BillingCycle, { displayPrice: string; priceKey: PriceKey }>;
  note: string;
  recommended?: boolean;
  features: readonly string[];
};
const plans: readonly PlanCard[] = [
  { key: "free", name: "Starter", price: "Grátis", note: "após 30 dias de Full Access", features: ["1 domínio e 1 cliente", "Screenshot", "Marcadores Pass e Fail", "Configuração local"] },
  { key: "pro", name: "Pro", price: planCatalog.pro.monthly.displayPrice, prices: planCatalog.pro, note: "para profissionais e pequenos times", recommended: true, features: ["10 domínios e 25 clientes", "Gravação e anotações", "Inspectors e JSON Diff", "Exportação completa"] },
  { key: "scale", name: "Scale", price: planCatalog.scale.monthly.displayPrice, prices: planCatalog.scale, note: "Full Access para operações que escalam", features: ["Domínios e clientes sem limite prático", "HTTP Controls avançados", "Histórico ampliado", "Prioridade em novidades"] },
];
const privacyPolicyUrl = "https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/privacy-policy/";

export function PopupApp() {
  const localizedRootRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<Tab>("setup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [authResolved, setAuthResolved] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState("");
  const [entitlements, setEntitlements] = useState<EntitlementCache | null>(null);
  const [theme, setTheme] = useState<ThemeKey>("red");
  const [colorMode, setColorMode] = useState<ColorMode>("dark");
  const [voucherCode, setVoucherCode] = useState("");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("yearly");
  const [locale, setLocale] = useState<Locale>("pt-BR");
  const t = (key: string) => translate(locale, key);
  useEffect(() => localizedRootRef.current ? localizeDom(localizedRootRef.current, locale) : undefined, [locale]);
  const logoUrl = browser.runtime.getURL("/icons/logo.svg");
  const themesEnabled = entitlements?.featureFlags?.["themes.enabled"]?.enabled !== false;
  const wizardEnabled = entitlements?.featureFlags?.["onboarding.wizard.enabled"]?.enabled !== false;

  useEffect(() => {
    void browser.storage.local.get(["qtsAppearance", "qtsLocale"]).then(({ qtsAppearance, qtsLocale }) => {
      const saved = qtsAppearance as { theme?: unknown; mode?: unknown } | undefined;
      if (isThemeKey(saved?.theme)) setTheme(saved.theme);
      if (saved?.mode === "light" || saved?.mode === "dark") setColorMode(saved.mode);
      if (isLocale(qtsLocale)) setLocale(qtsLocale);
    });
    try {
      void authorizeExtensionSurface(createAuthApi()).then(async (session) => {
        setSignedIn(Boolean(session));
        setSignedInEmail(session?.user.email ?? "");
        if (!session) setTab("account");
        if (session) setEntitlements(await refreshEntitlements(session.accessToken));
      }).finally(() => setAuthResolved(true));
    } catch { setTab("account"); setAuthResolved(true); }
  }, []);

  const openTab = (nextTab: Tab) => {
    if (protectedTabs.has(nextTab) && !signedIn) {
      setMessage("Entre na sua conta para acessar as configurações.");
      setTab("account");
      return;
    }
    setMessage("");
    setTab(nextTab);
  };

  const saveAppearance = (nextTheme: ThemeKey, nextMode: ColorMode) => {
    setTheme(nextTheme); setColorMode(nextMode);
    void browser.storage.local.set({ qtsAppearance: { theme: nextTheme, mode: nextMode } });
  };
  const saveLocale = (nextLocale: Locale) => { setLocale(nextLocale); void browser.storage.local.set({ qtsLocale: nextLocale }); };

  const redeemVoucher = async () => {
    setBusy(true); setMessage("");
    try {
      const token = await createAuthApi().accessToken();
      if (!token) throw new Error("Faça login antes de resgatar um voucher.");
      await createBillingApi().redeemVoucher(token, voucherCode.trim().toUpperCase());
      setVoucherCode("");
      setEntitlements(await refreshEntitlements(token));
      setMessage("Voucher ativado. Seu acesso foi atualizado.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Voucher indisponível."); }
    finally { setBusy(false); }
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
      const session = await auth.session();
      setSignedIn(Boolean(session));
      setSignedInEmail(session?.user.email ?? email.trim());
      if (session) setEntitlements(await refreshEntitlements(session.accessToken));
      setPassword("");
      setMessage("Conta conectada e sessão salva neste navegador."); setTab("setup");
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
      const priceKey = plans.find((item) => item.key === plan)?.prices?.[billingCycle].priceKey;
      if (!priceKey) throw new Error("Plano indisponível");
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

  if (!authResolved) return <main className="qtsControlCenter" data-theme={theme} data-mode={colorMode}><section className="qtsAuthLoading" role="status">Verificando sua sessão...</section></main>;

  const activeTab = protectedTabs.has(tab) && !signedIn ? "account" : tab;
  const pageTitle = ({ setup: "Configuração guiada", workspace: "Workspace de QA", plans: "Planos e acesso", account: "Minha conta", breakpoints: "Laboratório responsivo", convertio: "Conversão para GIF", data: "Dados e segurança", faq: "Central de ajuda", about: "Sobre o produto" } as const)[tab];

  return <main ref={localizedRootRef} className="qtsControlCenter" data-theme={theme} data-mode={colorMode}>
    <aside className="qtsControlNav">
      <img src={logoUrl} width="192" height="192" alt="QA Sandbox Toolbar" />
      <nav><button className={activeTab === "setup" ? "isActive" : ""} onClick={() => openTab("setup")}><FiSettings /> {t("common.settings")}</button><button className={activeTab === "workspace" ? "isActive" : ""} onClick={() => openTab("workspace")}><FiSettings /> Workspace</button><button className={activeTab === "plans" ? "isActive" : ""} onClick={() => openTab("plans")}><FiStar /> {t("common.plans")}</button><button className={activeTab === "account" ? "isActive" : ""} onClick={() => openTab("account")}><FiUser /> {t("common.account")}</button><button className={activeTab === "breakpoints" ? "isActive" : ""} onClick={() => openTab("breakpoints")}><FiMonitor /> {t("navigation.breakpoints")}</button><button className={activeTab === "convertio" ? "isActive" : ""} onClick={() => openTab("convertio")}><FiZap /> {t("navigation.convertio")}</button><button className={activeTab === "data" ? "isActive" : ""} onClick={() => openTab("data")}><FiShield /> {t("navigation.data")}</button><button className={activeTab === "faq" ? "isActive" : ""} onClick={() => openTab("faq")}><FiHelpCircle /> FAQ</button><button className={activeTab === "about" ? "isActive" : ""} onClick={() => openTab("about")}><FiInfo /> About</button></nav>
      <label className="qtsLocaleSelector">{t("common.language")}<select value={locale} onChange={(event) => saveLocale(event.target.value as Locale)}><option value="pt-BR">Português (Brasil)</option><option value="en">English</option><option value="es">Español</option></select></label>
      <div className="qtsTrialBadge"><FiGift /><span><b>{entitlements ? entitlements.trial.active ? `${entitlements.trial.daysRemaining} dias Full Access` : `${entitlements.plan.name} Full Access` : signedIn ? "Sincronizando acesso" : "Acesso Starter"}</b><small>{entitlements?.access.active && !entitlements.access.expiresAt ? "Acesso permanente" : entitlements?.access.expiresAt ? `Válido até ${new Date(entitlements.access.expiresAt).toLocaleDateString(locale)}` : "Entre para sincronizar seu plano"}</small></span></div>
    </aside>
    <section className="qtsControlContent">
      <header><div><small>QA SANDBOX TOOLBAR</small><h1>{pageTitle}</h1></div>{themesEnabled && <div className="qtsAppearance"><select value={theme} onChange={(event) => saveAppearance(event.target.value as ThemeKey, colorMode)} aria-label="Tema">{themeCatalog.map((item) => <option value={item.key} key={item.key}>{item.name}</option>)}</select><button onClick={() => saveAppearance(theme, colorMode === "dark" ? "light" : "dark")} aria-label="Alternar modo">{colorMode === "dark" ? <FiSun /> : <FiMoon />}</button></div>}<span className="qtsConnection"><i /> {entitlements ? `${entitlements.plan.name}${entitlements.trial.active ? ` · ${entitlements.trial.daysRemaining} dias` : entitlements.access.active && !entitlements.access.expiresAt ? " · permanente" : ""}` : signedIn ? "Sincronizando" : "Modo Starter"}</span></header>
      {message && <div className="qtsControlMessage">{message}</div>}
      {entitlements?.access.expiryWarning && <div className="qtsControlMessage">Seu acesso expira em {entitlements.access.daysRemaining} dias. Renove ou aplique outro voucher para não interromper seus testes.</div>}

      {tab === "setup" && (wizardEnabled ? <SetupWizard maximumUrls={entitlements?.trial.active ? 9999 : Number(entitlements?.features["domains.maximum"] ?? 1)} onMessage={setMessage} /> : <div className="qtsControlMessage">O onboarding está temporariamente desativado por uma feature flag.</div>)}
      {tab === "data" && <LocalDataManager onMessage={setMessage} />}
      {tab === "convertio" && <ConvertioSettings onMessage={setMessage} />}
      {tab === "breakpoints" && <BreakpointViewer onMessage={setMessage} />}
      {tab === "workspace" && <WorkspaceManager onMessage={setMessage} />}
      {tab === "faq" && <HelpCenter mode="faq" entitlement={entitlements} signedIn={signedIn} locale={locale} />}
      {tab === "about" && <HelpCenter mode="about" entitlement={entitlements} signedIn={signedIn} locale={locale} />}

      {tab === "plans" && <><div className="qtsCycle"><button className={billingCycle === "monthly" ? "isActive" : ""} onClick={() => setBillingCycle("monthly")}>Mensal</button><button className={billingCycle === "yearly" ? "isActive" : ""} onClick={() => setBillingCycle("yearly")}>Anual · até 25% OFF</button></div><div className="qtsPlanGrid">{plans.map((plan) => { const selectedPrice = plan.prices?.[billingCycle]; return <article className={plan.recommended ? "isRecommended" : ""} key={plan.key}>{plan.recommended && <em><FiStar /> Recomendado</em>}<h2>{plan.name}</h2><p>{plan.note}</p><strong>{selectedPrice?.displayPrice ?? plan.price} {selectedPrice && <small>/mês</small>}</strong>{selectedPrice && billingCycle === "yearly" && <p>Cobrança anual com desconto maior.</p>}<ul>{plan.features.map((feature) => <li key={feature}><FiCheck /> {feature}</li>)}</ul>{plan.key === "free" ? <button onClick={() => { setVoucherCode("30DIAS"); setTab("account"); }}>Começar trial grátis</button> : <button className="qtsPrimary" disabled={busy} onClick={() => void checkout(plan.key)}>{busy ? "Abrindo..." : `Escolher ${plan.name} ${billingCycle === "yearly" ? "anual" : "mensal"}`} <FiExternalLink /></button>}</article>; })}</div><div className="qtsPromo"><FiGift /><span><b>Lançamento: 30OFF</b><small>30% de desconto nos três primeiros meses, limitado às primeiras 15 pessoas.</small></span></div></>}

      {tab === "account" && <div className="qtsAccountLayout"><section>{signedIn ? <><div className="qtsSignedIn"><FiCheck /><span><small>SESSÃO ATIVA</small><strong>{signedInEmail || "Conta conectada"}</strong><p>Você continuará conectado ao fechar e reabrir o navegador.</p></span></div><label>Voucher de acesso <small>uso único</small><input value={voucherCode} onChange={(event) => setVoucherCode(event.target.value.toUpperCase())} placeholder="Digite seu código" /></label><button className="qtsPrimary" disabled={busy || voucherCode.trim().length < 8} onClick={() => void redeemVoucher()}>Resgatar voucher</button></> : <><div className="qtsAuthSwitch"><button className={mode === "signup" ? "isActive" : ""} onClick={() => setMode("signup")}>Criar conta</button><button className={mode === "login" ? "isActive" : ""} onClick={() => setMode("login")}>Entrar</button></div><label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "Mínimo de 10 caracteres" : "Sua senha"} /></label>{mode === "signup" && <><label>Código de indicação <small>opcional</small><input value={referralCode} onChange={(event) => setReferralCode(event.target.value.toUpperCase())} placeholder="QTS-XXXXXXXX" /></label><label className="qtsTerms"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>Li e aceito os termos e a <a href={privacyPolicyUrl} target="_blank" rel="noreferrer">Política de Privacidade</a>.</span></label></>}<button className="qtsPrimary" disabled={busy} onClick={() => void authenticate()}>{busy ? "Aguarde..." : mode === "signup" ? "Criar conta e ativar 30 dias" : "Entrar na minha conta"}</button></>}</section><aside><FiZap /><h2>Indique e ganhe</h2><p>Seu indicado recebe 20% por três meses. Após a primeira cobrança confirmada, você recebe crédito equivalente a um mês Pro.</p><div><FiCreditCard /> Crédito aplicado na próxima fatura</div>{signedIn && <><button onClick={() => void portal()}>Gerenciar assinatura <FiExternalLink /></button><button className="qtsSignOut" onClick={() => void createAuthApi().signOut().then(() => { setSignedIn(false); setSignedInEmail(""); setEntitlements(null); })}><FiLogOut /> Sair</button></>}</aside></div>}
    </section>
  </main>;
}
