import { useEffect, useMemo, useState } from "react";
import {
  FiArrowLeft,
  FiArrowRight,
  FiCheck,
  FiCreditCard,
  FiGlobe,
  FiHelpCircle,
  FiImage,
  FiPlus,
  FiServer,
  FiShield,
  FiSkipForward,
  FiTrash2,
  FiUser,
  FiX,
} from "react-icons/fi";
import {
  localWorkspaceSchema,
  type LocalWorkspace,
  type Project,
} from "@qts/domain";
import { emptyWorkspace } from "../services/localWorkspace";
import {
  normalizeUrlPattern,
  normalizeUrlPatterns,
  permissionOrigins,
  urlMatchesAny,
} from "../services/workspace";

type EnvironmentDraft = {
  id: string;
  name: string;
  color: string;
  riskLevel: "low" | "medium" | "high" | "critical";
};
type AssignedUrl = { value: string; environmentId: string; broad: boolean };
type TestAccount = {
  id: string;
  email: string;
  password: string;
  inboxUrl: string;
  environmentIds: string[];
  image: string;
};
type PaymentMethod = {
  id: string;
  brand: string;
  number: string;
  holder: string;
  cvv: string;
  expiration: string;
  scenario: string;
  environmentIds: string[];
};
type WizardData = {
  clientName: string;
  projectName: string;
  productName: string;
  projectImage: string;
  clientImage: string;
  subscriptionImage: string;
  environments: EnvironmentDraft[];
  urls: AssignedUrl[];
  accounts: TestAccount[];
  payments: PaymentMethod[];
  inspectorsEnabled: boolean;
  inspectorEndpoints: string[];
};

const colors = ["#ef1823", "#3b82f6", "#f59e0b", "#22c55e", "#a855f7"];
const steps = [
  "Projeto",
  "Ambientes",
  "URLs",
  "Contas",
  "Pagamentos",
  "Inspectors",
];
const requiredSteps = new Set([0, 1, 2]);

export function SetupWizard({
  maximumUrls,
  onMessage,
}: {
  maximumUrls: number;
  onMessage: (message: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>({
    clientName: "",
    projectName: "",
    productName: "",
    projectImage: "",
    clientImage: "",
    subscriptionImage: "",
    environments: [],
    urls: [],
    accounts: [],
    payments: [],
    inspectorsEnabled: true,
    inspectorEndpoints: [
      "get-candy",
      "get-member",
      "get-history",
      "get-prices",
      "checkout",
    ],
  });
  const [environmentInput, setEnvironmentInput] = useState("");
  const [environmentColor, setEnvironmentColor] = useState(colors[0]!);
  const [environmentRisk, setEnvironmentRisk] =
    useState<EnvironmentDraft["riskLevel"]>("low");
  const [urlInput, setUrlInput] = useState("");
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountImage, setAccountImage] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountInbox, setAccountInbox] = useState("");
  const [paymentBrand, setPaymentBrand] = useState("");
  const [paymentScenario, setPaymentScenario] = useState("");
  const [paymentNumber, setPaymentNumber] = useState("");
  const [paymentHolder, setPaymentHolder] = useState("");
  const [paymentCvv, setPaymentCvv] = useState("");
  const [paymentExpiration, setPaymentExpiration] = useState("");
  const [inspectorInput, setInspectorInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void browser.storage.local
      .get(["qtsWizardData", "qtsSetup"])
      .then((stored) => {
        if (stored.qtsWizardData) {
          const restored = stored.qtsWizardData as WizardData;
          setData({
            ...restored,
            clientName: restored.clientName || "Cliente QA",
            productName:
              restored.productName || restored.projectName || "Produto QA",
            inspectorEndpoints: restored.inspectorEndpoints ?? [
              "get-candy",
              "get-member",
              "get-history",
              "get-prices",
              "checkout",
            ],
          });
          setSelectedEnvironmentId(restored.environments[0]?.id ?? "");
          return;
        }
        const legacy = stored.qtsSetup as
          | {
              projectName?: string;
              environmentName?: string;
              domains?: string[];
              urlPatterns?: string[];
            }
          | undefined;
        const environment: EnvironmentDraft = {
          id: crypto.randomUUID(),
          name: legacy?.environmentName || "Local",
          color: colors[0]!,
          riskLevel: "low",
        };
        const patterns = normalizeUrlPatterns(
          legacy?.urlPatterns ?? legacy?.domains ?? ["localhost"],
        );
        setData((current) => ({
          ...current,
          clientName: "Cliente QA",
          projectName: legacy?.projectName || "Meu projeto QA",
          productName: legacy?.projectName || "Produto QA",
          environments: [environment],
          urls: patterns.map((pattern) => ({
            ...pattern,
            environmentId: environment.id,
          })),
        }));
        setSelectedEnvironmentId(environment.id);
      });
  }, []);

  const requiredReady = useMemo(
    () =>
      data.projectName.trim().length >= 2 &&
      data.environments.length > 0 &&
      data.urls.length > 0,
    [data],
  );
  const broadAccess = data.urls.some((url) => url.broad || url.value === "*");

  const addEnvironment = () => {
    const name = environmentInput.trim();
    if (
      !name ||
      data.environments.some(
        (item) => item.name.toLowerCase() === name.toLowerCase(),
      )
    )
      return;
    const inferredRisk = /prod/i.test(name)
      ? "critical"
      : /stage|beta|hml|qa/i.test(name)
        ? "medium"
        : environmentRisk;
    const environment: EnvironmentDraft = {
      id: crypto.randomUUID(),
      name,
      color: environmentColor,
      riskLevel: inferredRisk,
    };
    setData((current) => ({
      ...current,
      environments: [...current.environments, environment],
    }));
    setSelectedEnvironmentId((current) => current || environment.id);
    setEnvironmentInput("");
    setEnvironmentColor(
      colors[(data.environments.length + 1) % colors.length]!,
    );
    setEnvironmentRisk("low");
  };

  const updateEnvironment = (id: string, patch: Partial<EnvironmentDraft>) =>
    setData((current) => ({
      ...current,
      environments: current.environments.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));

  const removeEnvironment = (environmentId: string) => {
    const remaining = data.environments.filter(
      (item) => item.id !== environmentId,
    );
    setData((current) => ({
      ...current,
      environments: current.environments.filter(
        (item) => item.id !== environmentId,
      ),
      urls: current.urls.filter((url) => url.environmentId !== environmentId),
    }));
    if (selectedEnvironmentId === environmentId)
      setSelectedEnvironmentId(remaining[0]?.id ?? "");
  };

  const addUrl = () => {
    const normalized = normalizeUrlPattern(urlInput);
    if (!normalized) {
      onMessage(
        "URL inválida. Exemplos: https://google.com/*, *.com.br/*, google.* ou *.",
      );
      return;
    }
    if (!selectedEnvironmentId) {
      onMessage("Escolha o ambiente desta URL.");
      return;
    }
    if (
      data.urls.some(
        (item) =>
          item.value === normalized.value &&
          item.environmentId === selectedEnvironmentId,
      )
    )
      return;
    if (data.urls.length >= maximumUrls) {
      onMessage(`Seu acesso atual permite ${maximumUrls} URLs.`);
      return;
    }
    setData((current) => ({
      ...current,
      urls: [
        ...current.urls,
        { ...normalized, environmentId: selectedEnvironmentId },
      ],
    }));
    setUrlInput("");
  };

  const canLeaveStep = () => {
    if (step === 0 && data.projectName.trim().length < 2)
      return "Informe o nome do projeto, por exemplo Loja Demo.";
    if (step === 1 && !data.environments.length)
      return "Adicione ao menos um ambiente.";
    if (step === 2 && !data.urls.length)
      return "Adicione ao menos uma URL em que a toolbar aparecerá.";
    return "";
  };

  const next = () => {
    const error = canLeaveStep();
    if (error) {
      onMessage(error);
      return;
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const goToStep = (index: number) => {
    if (index <= step) {
      setStep(index);
      return;
    }
    const missing =
      data.projectName.trim().length < 2
        ? "Informe o projeto antes de avançar."
        : !data.environments.length
          ? "Adicione um ambiente antes de avançar."
          : !data.urls.length && index > 2
            ? "Adicione uma URL antes de avançar."
            : "";
    if (missing) {
      onMessage(missing);
      return;
    }
    setStep(index);
  };

  const save = async () => {
    if (!requiredReady) {
      onMessage("Conclua Projeto, Ambientes e URLs antes de ativar a toolbar.");
      return;
    }
    setSaving(true);
    try {
      const normalized = normalizeUrlPatterns(
        data.urls.map((item) => item.value),
      );
      const origins = permissionOrigins(normalized).filter(
        (origin) => !/localhost|127\.0\.0\.1/.test(origin),
      );
      if (origins.length && !(await browser.permissions.request({ origins })))
        throw new Error(
          "Permissão não concedida. A toolbar não pode aparecer sem acesso às URLs escolhidas.",
        );
      const registered = await browser.scripting.getRegisteredContentScripts();
      const oldIds = registered
        .filter(
          (item) =>
            item.id.startsWith("qts-workspace-") ||
            item.id.startsWith("qts-domain-"),
        )
        .map((item) => item.id);
      if (oldIds.length)
        await browser.scripting.unregisterContentScripts({ ids: oldIds });
      if (origins.length)
        await browser.scripting.registerContentScripts([
          {
            id: "qts-workspace-active",
            matches: origins,
            js: ["content-scripts/content.js"],
            persistAcrossSessions: true,
            runAt: "document_idle",
          },
        ]);
      const projectId = crypto.randomUUID();
      const projects: Project[] = [
        {
          id: projectId,
          name: data.projectName.trim(),
          accentColor: "#ef1823",
          environments: data.environments.map((environment) => ({
            ...environment,
            urlPatterns: data.urls
              .filter((url) => url.environmentId === environment.id)
              .map((url) => url.value),
          })),
        },
      ];
      const firstEnvironment = data.environments[0]!;
      const localWorkspace = createWorkspaceFromWizard(data, projectId);
      await browser.storage.local.set({
        qtsLocalWorkspaceV2: localWorkspace,
        qtsWizardData: data,
        qtsProjects: projects,
        qtsActiveProjectId: projectId,
        qtsSetup: {
          projectName: data.projectName.trim(),
          environmentName: firstEnvironment.name,
          urlPatterns: data.urls.map((url) => url.value),
          domains: [],
        },
      });
      const tabs = await browser.tabs.query({});
      const matching = tabs.filter(
        (tab) =>
          tab.id &&
          tab.url &&
          urlMatchesAny(
            tab.url,
            data.urls.map((url) => url.value),
          ),
      );
      await Promise.all(matching.map((tab) => browser.tabs.reload(tab.id!)));
      onMessage(
        matching.length
          ? `Tudo pronto. ${matching.length} aba(s) recarregada(s); a toolbar deve aparecer agora.`
          : "Configuração salva. Abra uma URL cadastrada para ver a toolbar.",
      );
    } catch (error) {
      onMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível ativar a toolbar.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="qtsWizard">
      <ol className="qtsWizardSteps">
        {steps.map((label, index) => (
          <li
            className={
              index === step ? "isActive" : index < step ? "isDone" : ""
            }
            key={label}
          >
            <button onClick={() => goToStep(index)}>
              <span>{index < step ? <FiCheck /> : index + 1}</span>
              {label}
              {requiredSteps.has(index) && <small>obrigatório</small>}
            </button>
          </li>
        ))}
      </ol>
      <section className="qtsWizardCard">
        {step === 0 && (
          <>
            <WizardHead
              title="Organize o contexto do teste"
              text="Cliente, projeto e produto formam o contexto exibido na toolbar e compartilhado por todo o Workspace."
            />
            <div className="qtsLabeledGrid qtsProjectIdentity">
              <label>
                <span>Cliente</span>
                <input
                  autoFocus
                  value={data.clientName}
                  onChange={(event) =>
                    setData({ ...data, clientName: event.target.value })
                  }
                  placeholder="Ex.: ACME"
                />
              </label>
              <label>
                <span>Projeto</span>
                <input
                  value={data.projectName}
                  onChange={(event) =>
                    setData({ ...data, projectName: event.target.value })
                  }
                  placeholder="Ex.: Checkout"
                />
              </label>
              <label>
                <span>Produto ou aplicação</span>
                <input
                  value={data.productName}
                  onChange={(event) =>
                    setData({ ...data, productName: event.target.value })
                  }
                  placeholder="Ex.: Loja web"
                />
              </label>
            </div>
            <div className="qtsImageGrid">
              <ImageField
                label="Imagem do cliente"
                value={data.clientImage}
                onChange={(value) => setData({ ...data, clientImage: value })}
              />
              <ImageField
                label="Imagem do projeto"
                value={data.projectImage}
                onChange={(value) => setData({ ...data, projectImage: value })}
              />
              <ImageField
                label="Imagem do produto"
                value={data.subscriptionImage}
                onChange={(value) =>
                  setData({ ...data, subscriptionImage: value })
                }
              />
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <WizardHead
              title="Ambientes e identidade visual"
              text="Cada ambiente recebe uma cor exclusiva. A toolbar inteira usa essa cor quando a URL correspondente estiver aberta."
            />
            <div className="qtsEnvironmentComposer">
              <label>
                <span>Nome do ambiente</span>
                <input
                  value={environmentInput}
                  onChange={(event) => setEnvironmentInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addEnvironment();
                    }
                  }}
                  placeholder="Ex.: Homologação"
                />
              </label>
              <label>
                <span>Cor da toolbar</span>
                <div className="qtsColorField">
                  <input
                    type="color"
                    value={environmentColor}
                    onChange={(event) =>
                      setEnvironmentColor(event.target.value)
                    }
                  />
                  <code>{environmentColor.toUpperCase()}</code>
                </div>
              </label>
              <label>
                <span>Nível de risco</span>
                <select
                  value={environmentRisk}
                  onChange={(event) =>
                    setEnvironmentRisk(
                      event.target.value as EnvironmentDraft["riskLevel"],
                    )
                  }
                >
                  <option value="low">Baixo</option>
                  <option value="medium">Médio</option>
                  <option value="high">Alto</option>
                  <option value="critical">Crítico / Produção</option>
                </select>
              </label>
              <button className="qtsPrimary" onClick={addEnvironment}>
                <FiPlus /> Adicionar ambiente
              </button>
            </div>
            <div className="qtsEnvironmentPalette" aria-label="Cores rápidas">
              {colors.map((color) => (
                <button
                  key={color}
                  className={environmentColor === color ? "isSelected" : ""}
                  style={{ background: color }}
                  onClick={() => setEnvironmentColor(color)}
                  aria-label={`Usar cor ${color}`}
                />
              ))}
            </div>
            <div className="qtsEnvironmentCards">
              {data.environments.map((environment) => (
                <article
                  key={environment.id}
                  style={
                    {
                      "--environment-color": environment.color,
                    } as React.CSSProperties
                  }
                >
                  <i />
                  <div>
                    <input
                      value={environment.name}
                      onChange={(event) =>
                        updateEnvironment(environment.id, {
                          name: event.target.value,
                        })
                      }
                      aria-label={`Nome de ${environment.name}`}
                    />
                    <small>A barra inteira ficará nesta cor</small>
                  </div>
                  <input
                    type="color"
                    value={environment.color}
                    onChange={(event) =>
                      updateEnvironment(environment.id, {
                        color: event.target.value,
                      })
                    }
                    aria-label={`Cor de ${environment.name}`}
                  />
                  <select
                    value={environment.riskLevel}
                    onChange={(event) =>
                      updateEnvironment(environment.id, {
                        riskLevel: event.target
                          .value as EnvironmentDraft["riskLevel"],
                      })
                    }
                    aria-label={`Risco de ${environment.name}`}
                  >
                    <option value="low">Baixo risco</option>
                    <option value="medium">Risco médio</option>
                    <option value="high">Alto risco</option>
                    <option value="critical">Produção</option>
                  </select>
                  <button
                    aria-label={`Excluir ${environment.name}`}
                    onClick={() => removeEnvironment(environment.id)}
                  >
                    <FiTrash2 />
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <WizardHead
              title="Em quais URLs a toolbar deve aparecer?"
              text="Protocolos, caminhos e curingas são aceitos. Cada URL fica ligada a um ambiente."
            />
            <div className="qtsUrlComposer">
              <select
                value={selectedEnvironmentId}
                onChange={(event) =>
                  setSelectedEnvironmentId(event.target.value)
                }
              >
                {data.environments.map((environment) => (
                  <option value={environment.id} key={environment.id}>
                    {environment.name}
                  </option>
                ))}
              </select>
              <PillInput
                value={urlInput}
                setValue={setUrlInput}
                onAdd={addUrl}
                placeholder="https://google.com/*"
              />
            </div>
            <div className="qtsExamples">
              <b>Exemplos:</b>
              <button onClick={() => setUrlInput("https://google.com/*")}>
                https://google.com/*
              </button>
              <button onClick={() => setUrlInput("*.com.br/*")}>
                *.com.br/*
              </button>
              <button onClick={() => setUrlInput("google.*")}>google.*</button>
              <button onClick={() => setUrlInput("*")}>* (todos)</button>
            </div>
            {broadAccess && (
              <div className="qtsBroadWarning">
                <FiShield />
                <span>
                  <b>Acesso amplo solicitado</b>
                  <small>
                    O Chrome exigirá acesso a todos os sites para suportar * ou
                    curingas de domínio. A extensão ainda monta a toolbar
                    somente nas URLs salvas.
                  </small>
                </span>
              </div>
            )}
            <div className="qtsPills qtsUrlPills">
              {data.urls.map((url) => (
                <span key={`${url.environmentId}:${url.value}`}>
                  <small>
                    {
                      data.environments.find(
                        (item) => item.id === url.environmentId,
                      )?.name
                    }
                  </small>
                  {url.value}
                  <button
                    aria-label={`Excluir ${url.value}`}
                    onClick={() =>
                      setData((current) => ({
                        ...current,
                        urls: current.urls.filter((item) => item !== url),
                      }))
                    }
                  >
                    <FiX />
                  </button>
                </span>
              ))}
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <WizardHead
              title="Contas de teste"
              text="Organize credenciais sandbox por contexto. Os dados ficam somente no perfil local do Chrome."
            />
            <div className="qtsFormSection">
              <header>
                <FiUser />
                <div>
                  <b>Nova conta sandbox</b>
                  <small>Nunca cadastre credenciais reais.</small>
                </div>
              </header>
              <div className="qtsLabeledGrid">
                <label>
                  <span>E-mail ou login</span>
                  <input
                    type="email"
                    value={accountEmail}
                    onChange={(event) => setAccountEmail(event.target.value)}
                    placeholder="qa@empresa.test"
                  />
                </label>
                <label>
                  <span>Senha de teste</span>
                  <input
                    type="password"
                    value={accountPassword}
                    onChange={(event) => setAccountPassword(event.target.value)}
                    placeholder="Somente sandbox"
                  />
                </label>
                <label className="isWide">
                  <span>Inbox / caixa de e-mail</span>
                  <input
                    type="url"
                    value={accountInbox}
                    onChange={(event) => setAccountInbox(event.target.value)}
                    placeholder="https://mail.exemplo.test"
                  />
                </label>
              </div>
              <ImageField
                label="Avatar ou identificação visual"
                value={accountImage}
                onChange={setAccountImage}
              />
              <button
                className="qtsPrimary qtsFormSubmit"
                onClick={() => {
                  if (!accountEmail.trim()) return;
                  setData({
                    ...data,
                    accounts: [
                      ...data.accounts,
                      {
                        id: crypto.randomUUID(),
                        email: accountEmail.trim(),
                        password: accountPassword,
                        inboxUrl: accountInbox.trim(),
                        image: accountImage.trim(),
                        environmentIds: data.environments.map(
                          (item) => item.id,
                        ),
                      },
                    ],
                  });
                  setAccountEmail("");
                  setAccountPassword("");
                  setAccountInbox("");
                  setAccountImage("");
                }}
              >
                <FiPlus /> Adicionar conta
              </button>
            </div>
            <EntityList
              icon="account"
              items={data.accounts.map((item) => ({
                id: item.id,
                title: item.email,
                subtitle: `${item.environmentIds.length} ambiente(s) · ${item.inboxUrl ? "inbox configurado" : "sem inbox"}`,
              }))}
              onRemove={(id) =>
                setData({
                  ...data,
                  accounts: data.accounts.filter((item) => item.id !== id),
                })
              }
            />
          </>
        )}
        {step === 4 && (
          <>
            <WizardHead
              title="Métodos de pagamento sandbox"
              text="Crie uma biblioteca segura de cenários aprovados, recusados e exceções de teste."
            />
            <div className="qtsFormSection">
              <header>
                <FiCreditCard />
                <div>
                  <b>Novo método sandbox</b>
                  <small>
                    Use somente números fornecidos pelo gateway de testes.
                  </small>
                </div>
              </header>
              <div className="qtsLabeledGrid qtsPaymentGrid">
                <label>
                  <span>Provedor ou bandeira</span>
                  <input
                    value={paymentBrand}
                    onChange={(event) => setPaymentBrand(event.target.value)}
                    placeholder="Stripe · Visa"
                  />
                </label>
                <label>
                  <span>Número sandbox</span>
                  <input
                    inputMode="numeric"
                    value={paymentNumber}
                    onChange={(event) => setPaymentNumber(event.target.value)}
                    placeholder="4242 4242 4242 4242"
                  />
                </label>
                <label>
                  <span>Titular</span>
                  <input
                    value={paymentHolder}
                    onChange={(event) => setPaymentHolder(event.target.value)}
                    placeholder="QA Tester"
                  />
                </label>
                <label>
                  <span>Validade</span>
                  <input
                    value={paymentExpiration}
                    onChange={(event) =>
                      setPaymentExpiration(event.target.value)
                    }
                    placeholder="MM/AA"
                  />
                </label>
                <label>
                  <span>CVV sandbox</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={paymentCvv}
                    onChange={(event) => setPaymentCvv(event.target.value)}
                    placeholder="123"
                  />
                </label>
                <label>
                  <span>Resultado esperado</span>
                  <input
                    value={paymentScenario}
                    onChange={(event) => setPaymentScenario(event.target.value)}
                    placeholder="Pagamento aprovado"
                  />
                </label>
              </div>
              <button
                className="qtsPrimary qtsFormSubmit"
                onClick={() => {
                  if (!paymentBrand.trim()) return;
                  setData({
                    ...data,
                    payments: [
                      ...data.payments,
                      {
                        id: crypto.randomUUID(),
                        brand: paymentBrand.trim(),
                        number: paymentNumber.trim(),
                        holder: paymentHolder.trim(),
                        cvv: paymentCvv.trim(),
                        expiration: paymentExpiration.trim(),
                        scenario: paymentScenario.trim(),
                        environmentIds: data.environments.map(
                          (item) => item.id,
                        ),
                      },
                    ],
                  });
                  setPaymentBrand("");
                  setPaymentNumber("");
                  setPaymentHolder("");
                  setPaymentCvv("");
                  setPaymentExpiration("");
                  setPaymentScenario("");
                }}
              >
                <FiPlus /> Adicionar método
              </button>
            </div>
            <EntityList
              icon="payment"
              items={data.payments.map((item) => ({
                id: item.id,
                title: item.brand,
                subtitle: `${item.scenario || "Sem cenário"} · final ${item.number.slice(-4) || "----"}`,
              }))}
              onRemove={(id) =>
                setData({
                  ...data,
                  payments: data.payments.filter((item) => item.id !== id),
                })
              }
            />
          </>
        )}
        {step === 5 && (
          <>
            <WizardHead
              title="Inspectors de API"
              text="Defina quais respostas da aplicação serão reconhecidas e transformadas em informação útil para QA."
            />
            <label className="qtsFeatureSwitch">
              <span className="qtsSwitch">
                <input
                  type="checkbox"
                  checked={data.inspectorsEnabled}
                  onChange={(event) =>
                    setData({
                      ...data,
                      inspectorsEnabled: event.target.checked,
                    })
                  }
                />
                <i />
              </span>
              <span>
                <b>Captura declarativa ativada</b>
                <small>
                  Observa Fetch/XHR da página, sanitiza dados sensíveis e nunca
                  executa código vindo da configuração.
                </small>
              </span>
            </label>
            <div className="qtsFormSection">
              <header>
                <FiServer />
                <div>
                  <b>Adicionar endpoint observado</b>
                  <small>
                    Informe o identificador após `/api/`. Você poderá configurar
                    campos e visualização no Workspace.
                  </small>
                </div>
              </header>
              <div className="qtsInspectorAdd">
                <span>/api/</span>
                <input
                  value={inspectorInput}
                  onChange={(event) => setInspectorInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const endpoint = inspectorInput
                        .trim()
                        .replace(/^\/api\//i, "")
                        .toLowerCase();
                      if (
                        /^[a-z0-9][a-z0-9_-]*$/.test(endpoint) &&
                        !data.inspectorEndpoints.includes(endpoint)
                      ) {
                        setData({
                          ...data,
                          inspectorEndpoints: [
                            ...data.inspectorEndpoints,
                            endpoint,
                          ],
                        });
                        setInspectorInput("");
                      }
                    }
                  }}
                  placeholder="orders"
                />
                <button
                  onClick={() => {
                    const endpoint = inspectorInput
                      .trim()
                      .replace(/^\/api\//i, "")
                      .toLowerCase();
                    if (
                      !/^[a-z0-9][a-z0-9_-]*$/.test(endpoint) ||
                      data.inspectorEndpoints.includes(endpoint)
                    )
                      return;
                    setData({
                      ...data,
                      inspectorEndpoints: [
                        ...data.inspectorEndpoints,
                        endpoint,
                      ],
                    });
                    setInspectorInput("");
                  }}
                >
                  <FiPlus /> Adicionar
                </button>
              </div>
            </div>
            <div className="qtsInspectorCards">
              {data.inspectorEndpoints.map((endpoint) => (
                <article key={endpoint}>
                  <FiGlobe />
                  <div>
                    <b>{endpoint}</b>
                    <code>/api/{endpoint}</code>
                  </div>
                  <span>ANY</span>
                  <button
                    aria-label={`Excluir inspector ${endpoint}`}
                    onClick={() =>
                      setData({
                        ...data,
                        inspectorEndpoints: data.inspectorEndpoints.filter(
                          (item) => item !== endpoint,
                        ),
                      })
                    }
                  >
                    <FiTrash2 />
                  </button>
                </article>
              ))}
            </div>
            <div className="qtsWizardSummary">
              <FiCheck />
              <span>
                <b>Revisão do workspace</b>
                <small>
                  {data.projectName} · {data.environments.length} ambientes ·{" "}
                  {data.urls.length} URLs · {data.accounts.length} contas ·{" "}
                  {data.payments.length} pagamentos ·{" "}
                  {data.inspectorEndpoints.length} inspectors
                </small>
              </span>
            </div>
          </>
        )}
        <footer>
          <button
            className="qtsWizardBack"
            disabled={step === 0}
            onClick={() => setStep((current) => current - 1)}
          >
            <FiArrowLeft /> Voltar
          </button>
          <div>
            {!requiredSteps.has(step) && step < steps.length - 1 && (
              <button className="qtsWizardSkip" onClick={next}>
                <FiSkipForward /> Pular por enquanto
              </button>
            )}
            {step < steps.length - 1 ? (
              <button className="qtsPrimary" onClick={next}>
                Continuar <FiArrowRight />
              </button>
            ) : (
              <button
                className="qtsPrimary"
                disabled={saving}
                onClick={() => void save()}
              >
                <FiCheck /> {saving ? "Ativando..." : "Salvar e ativar toolbar"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

function WizardHead({ title, text }: { title: string; text: string }) {
  return (
    <header className="qtsWizardHead">
      <h2>{title}</h2>
      <p>{text}</p>
    </header>
  );
}
function Info({ text }: { text: string }) {
  return (
    <button className="qtsInfo" type="button" title={text} aria-label={text}>
      <FiHelpCircle />
    </button>
  );
}
function PillInput({
  value,
  setValue,
  onAdd,
  placeholder,
}: {
  value: string;
  setValue: (value: string) => void;
  onAdd: () => void;
  placeholder: string;
}) {
  return (
    <div className="qtsPillInput">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            onAdd();
          }
        }}
        placeholder={placeholder}
      />
      <button onClick={onAdd}>
        <FiPlus /> Adicionar
      </button>
    </div>
  );
}
function ImageField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="qtsImageField">
      <span>
        <FiImage /> {label}{" "}
        <Info text="Opcional. Use uma URL HTTPS ou importe uma imagem pequena; ela fica somente neste navegador." />
      </span>
      <input
        value={value.startsWith("data:") ? "Imagem importada" : value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="https://..."
        disabled={value.startsWith("data:")}
      />
      <input
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > 512_000) {
            event.target.value = "";
            return;
          }
          const reader = new FileReader();
          reader.onload = () => onChange(String(reader.result || ""));
          reader.readAsDataURL(file);
        }}
      />
      {value && (
        <button type="button" onClick={() => onChange("")}>
          <FiTrash2 /> Remover
        </button>
      )}
    </label>
  );
}
function EntityList({
  items,
  onRemove,
  icon = "account",
}: {
  items: { id: string; title: string; subtitle: string }[];
  onRemove: (id: string) => void;
  icon?: "account" | "payment";
}) {
  return (
    <div className="qtsEntityList qtsProfessionalList">
      {items.length ? (
        items.map((item) => (
          <article key={item.id}>
            {icon === "payment" ? <FiCreditCard /> : <FiUser />}
            <span>
              <b>{item.title}</b>
              <small>{item.subtitle}</small>
            </span>
            <button
              onClick={() => onRemove(item.id)}
              aria-label={`Excluir ${item.title}`}
            >
              <FiTrash2 />
            </button>
          </article>
        ))
      ) : (
        <div className="qtsEmptyState">
          {icon === "payment" ? <FiCreditCard /> : <FiUser />}
          <b>Nenhum item cadastrado</b>
          <span>
            Esta etapa é opcional e pode ser concluída depois no Workspace.
          </span>
        </div>
      )}
    </div>
  );
}

function createWorkspaceFromWizard(
  data: WizardData,
  projectId: string,
): LocalWorkspace {
  const workspace = emptyWorkspace();
  const now = new Date().toISOString();
  const clientId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const common = (
    id: string,
    name: string,
    image: string,
    color: string,
    order = 0,
  ) => ({
    id,
    name,
    shortName: name.slice(0, 32),
    description: "",
    image,
    images: [],
    color,
    tags: [],
    active: true,
    order,
    createdAt: now,
    updatedAt: now,
  });
  const environmentIds = data.environments.map((item) => item.id);
  return localWorkspaceSchema.parse({
    ...workspace,
    applicationVersion: browser.runtime.getManifest().version,
    activeProjectId: projectId,
    clients: [
      {
        ...common(
          clientId,
          data.clientName.trim() || "Cliente QA",
          data.clientImage,
          "#64748b",
        ),
        notes: "",
      },
    ],
    projects: [
      {
        ...common(
          projectId,
          data.projectName.trim(),
          data.projectImage,
          "#ef1823",
        ),
        clientId,
        productIds: [productId],
      },
    ],
    products: [
      {
        ...common(
          productId,
          data.productName.trim() || data.projectName.trim(),
          data.subscriptionImage,
          "#64748b",
        ),
        clientId,
        projectIds: [projectId],
        code: (data.productName || data.projectName).slice(0, 20).toUpperCase(),
        kind: "application",
      },
    ],
    environments: data.environments.map((item, order) => ({
      ...common(item.id, item.name, "", item.color, order),
      projectId,
      riskLevel: item.riskLevel,
      urlPatterns: data.urls
        .filter((url) => url.environmentId === item.id)
        .map((url) => url.value),
    })),
    accounts: data.accounts.map((item, order) => ({
      ...common(
        item.id,
        item.email || `Conta ${order + 1}`,
        item.image,
        "#64748b",
        order,
      ),
      typeId: null,
      email: item.email,
      username: "",
      password: item.password,
      inboxUrl: item.inboxUrl,
      environmentIds: item.environmentIds,
      attributes: {},
      sensitive: true,
    })),
    paymentMethods: data.payments.map((item, order) => ({
      ...common(
        item.id,
        item.scenario || item.brand || `Pagamento ${order + 1}`,
        "",
        "#64748b",
        order,
      ),
      provider: item.brand,
      brand: item.brand,
      number: item.number,
      holder: item.holder,
      cvv: item.cvv,
      expiration: item.expiration,
      scenario: item.scenario,
      environmentIds: item.environmentIds,
    })),
    inspectors: data.inspectorEndpoints.map((endpoint, order) => ({
      ...common(crypto.randomUUID(), endpoint, "", "#64748b", order),
      apiId: null,
      pathPattern: `/api/${endpoint}`,
      method: "ANY",
      visualization: "friendly",
      primaryFields: [],
      listPath: "",
      filters: [],
      mappings: {},
      version: "1",
      status: data.inspectorsEnabled ? "active" : "disabled",
      minimumFeature: "inspectors.enabled",
      enabled: data.inspectorsEnabled,
    })),
  });
}
