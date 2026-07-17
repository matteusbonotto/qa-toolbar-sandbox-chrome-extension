import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { FiBox, FiBriefcase, FiCode, FiCopy, FiCreditCard, FiEdit2, FiGlobe, FiPlus, FiSearch, FiServer, FiTrash2, FiUser, FiUsers, FiX } from "react-icons/fi";
import { localWorkspaceSchema, type LocalWorkspace } from "@qts/domain";
import { emptyWorkspace, replaceWorkspaceEntity } from "../services/localWorkspace";

const storageKey = "qtsLocalWorkspaceV2";
const collections = [
  "clients",
  "projects",
  "products",
  "environments",
  "accountTypes",
  "accounts",
  "paymentMethods",
  "apis",
  "inspectors",
  "resources",
] as const;
type Collection = (typeof collections)[number];
type Entity = LocalWorkspace[Collection][number];
const labels: Record<Collection, string> = {
  clients: "Clientes",
  projects: "Projetos",
  products: "Produtos",
  environments: "Ambientes",
  accountTypes: "Tipos de conta",
  accounts: "Contas",
  paymentMethods: "Métodos sandbox",
  apis: "APIs",
  inspectors: "Inspectors",
  resources: "Recursos",
};

const base = (name: string, order: number) => ({
  id: crypto.randomUUID(),
  name,
  shortName: name.slice(0, 20),
  description: "",
  image: "",
  images: [],
  color: "#64748b",
  tags: [],
  active: true,
  order,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export function WorkspaceManager({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  const [workspace, setWorkspace] = useState<LocalWorkspace>(emptyWorkspace());
  const [collection, setCollection] = useState<Collection>("clients");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Entity | null>(null);
  const [editingDraft, setEditingDraft] = useState<Record<string, unknown>>({});
  const [editingJson, setEditingJson] = useState("");
  const [editingError, setEditingError] = useState("");
  useEffect(() => {
    void browser.storage.local.get(storageKey).then((stored) => {
      const parsed = localWorkspaceSchema.safeParse(
        stored[storageKey] ?? emptyWorkspace(),
      );
      if (parsed.success) setWorkspace(parsed.data);
    });
  }, []);
  const save = async (next: LocalWorkspace, message: string) => {
    const parsed = localWorkspaceSchema.parse(next);
    setWorkspace(parsed);
    await browser.storage.local.set({ [storageKey]: parsed });
    onMessage(message);
  };
  const visible = useMemo(
    () =>
      [...workspace[collection]]
        .filter(
          (item) =>
            item.name.toLowerCase().includes(query.toLowerCase()) &&
            (filter === "all" || item.active === (filter === "active")),
        )
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [workspace, collection, query, filter],
  );
  const create = async () => {
    const value = name.trim();
    if (!value) return;
    const common = base(value, workspace[collection].length);
    const clientId = workspace.clients[0]?.id ?? null;
    const projectId = workspace.projects[0]?.id ?? null;
    if (["projects", "products"].includes(collection) && !clientId) {
      onMessage("Crie um cliente antes deste item.");
      return;
    }
    if (["environments", "resources"].includes(collection) && !projectId) {
      onMessage("Crie um projeto antes deste item.");
      return;
    }
    const entity: Entity = (
      {
        clients: { ...common, notes: "" },
        projects: { ...common, clientId: clientId!, productIds: [] },
        products: {
          ...common,
          clientId: clientId!,
          projectIds: projectId ? [projectId] : [],
          code: common.shortName.toUpperCase(),
          kind: "other",
        },
        environments: {
          ...common,
          projectId: projectId!,
          riskLevel: "low",
          urlPatterns: [],
        },
        accountTypes: { ...common, attributeNames: [] },
        accounts: {
          ...common,
          typeId: workspace.accountTypes[0]?.id ?? null,
          email: "",
          username: "",
          password: "",
          inboxUrl: "",
          environmentIds: [],
          attributes: {},
          sensitive: true,
        },
        paymentMethods: {
          ...common,
          provider: "sandbox",
          brand: value,
          number: "",
          holder: "",
          cvv: "",
          expiration: "",
          scenario: "",
          environmentIds: [],
        },
        apis: {
          ...common,
          baseUrl: "https://example.invalid",
          environmentIds: [],
          endpoint: "/",
          method: "GET",
          headers: {},
          contentType: "application/json",
          timeoutMs: 15000,
          schema: {},
          redactionKeys: [],
        },
        inspectors: {
          ...common,
          apiId: workspace.apis[0]?.id ?? null,
          pathPattern: value.toLowerCase().replace(/\s+/g, "-"),
          method: "ANY",
          visualization: "friendly",
          primaryFields: [],
          listPath: "",
          filters: [],
          mappings: {},
          version: "1",
          status: "active",
          minimumFeature: "inspectors.enabled",
          enabled: true,
        },
        resources: {
          ...common,
          projectId: projectId!,
          kind: "link",
          url: "",
          content: "",
        },
      } satisfies Record<Collection, Entity>
    )[collection];
    await save(
      { ...workspace, [collection]: [...workspace[collection], entity] },
      `${labels[collection]}: item criado e validado.`,
    );
    setName("");
    openEditor(entity);
  };
  const patchEntity = async (
    id: string,
    patch: Record<string, unknown>,
    message: string,
  ) =>
    save(
      {
        ...workspace,
        [collection]: workspace[collection].map((item) =>
          item.id === id
            ? { ...item, ...patch, updatedAt: new Date().toISOString() }
            : item,
        ),
      },
      message,
    );
  const duplicate = async (item: Entity) => {
    const copy = {
      ...structuredClone(item),
      id: crypto.randomUUID(),
      name: `${item.name} — cópia`,
      order: workspace[collection].length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await save(
      { ...workspace, [collection]: [...workspace[collection], copy] },
      "Item duplicado.",
    );
  };
  const remove = async (id: string) => {
    if (
      !window.confirm(
        "Excluir este item? Relacionamentos inválidos serão rejeitados pela validação.",
      )
    )
      return;
    await save(
      {
        ...workspace,
        [collection]: workspace[collection].filter((item) => item.id !== id),
      },
      "Item excluído.",
    );
  };
  const move = async (item: Entity, direction: -1 | 1) => {
    const ordered = [...visible];
    const index = ordered.findIndex((entry) => entry.id === item.id);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const other = ordered[target]!;
    await save(
      {
        ...workspace,
        [collection]: workspace[collection].map((entry) =>
          entry.id === item.id
            ? { ...entry, order: other.order }
            : entry.id === other.id
              ? { ...entry, order: item.order }
              : entry,
        ),
      },
      "Ordem atualizada.",
    );
  };
  const addImage = async (item: Entity, file?: File) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(
        file.type,
      ) ||
      file.size > 512_000
    ) {
      onMessage("Use PNG, JPEG, WebP ou SVG de até 500 KB.");
      return;
    }
    const value = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const image = {
      id: crypto.randomUUID(),
      name: file.name.slice(0, 100),
      description: "",
      mimeType: file.type as
        "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml",
      source: "local" as const,
      value,
      preview: value,
      order: item.images.length,
      primary: item.images.length === 0,
    };
    await patchEntity(
      item.id,
      {
        images: [...item.images, image],
        image: item.images.length ? item.image : value,
      },
      "Imagem adicionada localmente.",
    );
  };
  const openEditor = (item: Entity) => {
    setEditing(item);
    setEditingDraft(structuredClone(item) as unknown as Record<string, unknown>);
    setEditingJson(JSON.stringify(item, null, 2));
    setEditingError("");
  };
  const saveEditor = async () => {
    if (!editing) return;
    try {
      const advanced = JSON.parse(editingJson) as Record<string, unknown>;
      const next = replaceWorkspaceEntity(workspace, collection, editing.id, { ...advanced, ...editingDraft, id: editing.id });
      await save(next, `${labels[collection]}: todos os campos foram validados e salvos.`);
      setEditing(null);
    } catch (error) {
      setEditingError(error instanceof Error ? error.message : "Não foi possível validar a entidade.");
    }
  };
  return (
    <section className="qtsWorkspaceManager">
      <header>
        <div>
          <small>CENTRAL DE DADOS DE QA</small>
          <h2>Workspace</h2>
          <p>Organize clientes, projetos, ambientes e ativos de teste em um só lugar.</p>
        </div>
        <div className="qtsWorkspaceStats"><b>{workspace[collection].length}</b><span>{labels[collection]}</span></div>
      </header>
      <div className="qtsWorkspaceBody">
      <nav className="qtsCollectionNav" aria-label="Tipos de dados do workspace">{collections.map((key) => <button key={key} className={collection === key ? "isActive" : ""} onClick={() => { setCollection(key); setQuery(""); }}>{collectionIcon(key)}<span>{labels[key]}</span><small>{workspace[key].length}</small></button>)}</nav>
      <main className="qtsWorkspaceContent">
      <header className="qtsWorkspaceSectionHead"><div><small>CONFIGURAÇÃO LOCAL</small><h3>{labels[collection]}</h3><p>Crie e mantenha os dados usados pela toolbar neste perfil do navegador.</p></div><span>{workspace[collection].length} configurado(s)</span></header>
      <div className="qtsCrudControls">
        <label>
          <FiSearch />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Buscar em ${labels[collection].toLowerCase()}`}
          />
        </label>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
        >
          <option value="all">Todos</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create();
          }}
          placeholder={`Nome do novo item em ${labels[collection].toLowerCase()}`}
        />
        <button onClick={() => void create()}>
          <FiPlus /> Criar
        </button>
      </div>
      <div className="qtsCrudList">
        {!visible.length && <div className="qtsWorkspaceEmpty">{collectionIcon(collection)}<h3>Nenhum item em {labels[collection].toLowerCase()}</h3><p>Use o campo acima para criar o primeiro item. Depois você poderá preencher todos os detalhes em um formulário guiado.</p></div>}
        {visible.map((item, index) => (
          <article key={item.id} data-inactive={!item.active}>
            <span
              className="qtsColorIndicator"
              style={{ background: item.color }}
              aria-label={`Cor ${item.color}; ${item.active ? "ativo" : "inativo"}`}
              title={`${item.color} · ${item.active ? "ativo" : "inativo"}`}
            />
            <div>
              <b>{item.name}</b>
              <small>
                {item.shortName || "Sem nome curto"} · ordem {item.order} · {item.images.length} imagem(ns)
              </small>
              {item.images.length > 0 && <span className="qtsImageChips">{item.images.map((image) => <button key={image.id} title={image.name} onClick={() => void patchEntity(item.id, { images: item.images.filter((entry) => entry.id !== image.id), image: item.image === image.value ? "" : item.image }, "Imagem removida.")}><img src={image.preview || image.value} alt="" /><span>{image.primary ? "Principal" : image.name}</span><FiTrash2 /></button>)}</span>}
            </div>
            <label className="qtsImageUpload">+ imagem<input hidden type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void addImage(item, event.target.files?.[0])} /></label>
            <button
              onClick={() => openEditor(item)}
              aria-label={`Editar ${item.name}`}
            >
              <FiEdit2 />
            </button>
            <button
              onClick={() => void duplicate(item)}
              aria-label={`Duplicar ${item.name}`}
            >
              <FiCopy />
            </button>
            <button
              onClick={() =>
                void patchEntity(
                  item.id,
                  { active: !item.active },
                  item.active ? "Item desativado." : "Item ativado.",
                )
              }
            >
              {item.active ? "Desativar" : "Ativar"}
            </button>
            <button disabled={index === 0} onClick={() => void move(item, -1)}>
              ↑
            </button>
            <button
              disabled={index === visible.length - 1}
              onClick={() => void move(item, 1)}
            >
              ↓
            </button>
            <button
              onClick={() => void remove(item.id)}
              aria-label={`Excluir ${item.name}`}
            >
              <FiTrash2 />
            </button>
          </article>
        ))}
      </div>
      </main>
      </div>
      {editing && <div className="qtsEntityEditorBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
        <section className="qtsEntityEditor" role="dialog" aria-modal="true" aria-labelledby="qts-entity-editor-title">
          <header><div><small>{labels[collection]}</small><h2 id="qts-entity-editor-title">Editar {editing.name}</h2><p>Preencha os dados usados pela toolbar e pelos fluxos de QA.</p></div><button onClick={() => setEditing(null)} aria-label="Fechar editor"><FiX /></button></header>
          <EntityFields collection={collection} draft={editingDraft} setDraft={setEditingDraft} workspace={workspace} />
          <details className="qtsAdvancedEditor"><summary><FiCode /> Configuração avançada em JSON</summary><p>Use somente quando precisar editar campos que ainda não aparecem no formulário. A validação completa continua obrigatória.</p><textarea spellCheck={false} value={editingJson} onChange={(event) => { setEditingJson(event.target.value); setEditingError(""); }} aria-label="Entidade em JSON" /></details>
          {editingError && <div className="qtsControlMessage" role="alert">{editingError}</div>}
          <footer><button onClick={() => setEditing(null)}>Cancelar</button><button className="qtsPrimary" onClick={() => void saveEditor()}>Validar e salvar</button></footer>
        </section>
      </div>}
    </section>
  );
}

function collectionIcon(collection: Collection) {
  return ({ clients: <FiUsers />, projects: <FiBriefcase />, products: <FiBox />, environments: <FiGlobe />, accountTypes: <FiUser />, accounts: <FiUser />, paymentMethods: <FiCreditCard />, apis: <FiServer />, inspectors: <FiSearch />, resources: <FiCode /> })[collection];
}

function EntityFields({ collection, draft, setDraft, workspace: _workspace }: { collection: Collection; draft: Record<string, unknown>; setDraft: Dispatch<SetStateAction<Record<string, unknown>>>; workspace: LocalWorkspace }) {
  const update = (key: string, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));
  const text = (key: string) => String(draft[key] ?? "");
  return <div className="qtsEntityForm">
    <section><h3>Identificação</h3><div className="qtsEntityFormGrid"><Field label="Nome" value={text("name")} onChange={(value) => update("name", value)} /><Field label="Nome curto" value={text("shortName")} onChange={(value) => update("shortName", value)} /><Field label="Descrição" value={text("description")} onChange={(value) => update("description", value)} wide /><label><span>Cor de identificação</span><div className="qtsEntityColor"><input type="color" value={text("color") || "#64748b"} onChange={(event) => update("color", event.target.value)} /><code>{text("color")}</code></div></label><label className="qtsEntityActive"><input type="checkbox" checked={Boolean(draft.active)} onChange={(event) => update("active", event.target.checked)} /><span><b>Item ativo</b><small>Disponível na toolbar e nos seletores</small></span></label></div></section>
    {collection === "environments" && <section><h3>Ambiente e URLs</h3><div className="qtsEntityFormGrid"><label><span>Nível de risco</span><select value={text("riskLevel")} onChange={(event) => update("riskLevel", event.target.value)}><option value="low">Baixo</option><option value="medium">Médio</option><option value="high">Alto</option><option value="critical">Crítico / Produção</option></select></label><Field label="Padrões de URL" value={Array.isArray(draft.urlPatterns) ? draft.urlPatterns.join("\n") : ""} onChange={(value) => update("urlPatterns", value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))} wide multiline help="Um padrão por linha. Ex.: https://app.exemplo.com/*" /></div></section>}
    {collection === "accounts" && <section><h3>Credenciais sandbox</h3><div className="qtsEntityFormGrid"><Field label="E-mail" type="email" value={text("email")} onChange={(value) => update("email", value)} /><Field label="Usuário" value={text("username")} onChange={(value) => update("username", value)} /><Field label="Senha de teste" type="password" value={text("password")} onChange={(value) => update("password", value)} /><Field label="URL do inbox" type="url" value={text("inboxUrl")} onChange={(value) => update("inboxUrl", value)} /></div></section>}
    {collection === "paymentMethods" && <section><h3>Dados de pagamento sandbox</h3><div className="qtsEntityFormGrid qtsThreeColumns"><Field label="Provedor" value={text("provider")} onChange={(value) => update("provider", value)} /><Field label="Bandeira" value={text("brand")} onChange={(value) => update("brand", value)} /><Field label="Número sandbox" value={text("number")} onChange={(value) => update("number", value)} /><Field label="Titular" value={text("holder")} onChange={(value) => update("holder", value)} /><Field label="Validade" value={text("expiration")} onChange={(value) => update("expiration", value)} /><Field label="CVV" type="password" value={text("cvv")} onChange={(value) => update("cvv", value)} /><Field label="Cenário esperado" value={text("scenario")} onChange={(value) => update("scenario", value)} wide /></div></section>}
    {collection === "apis" && <section><h3>Contrato da API</h3><div className="qtsEntityFormGrid"><Field label="URL base" type="url" value={text("baseUrl")} onChange={(value) => update("baseUrl", value)} wide /><Field label="Endpoint" value={text("endpoint")} onChange={(value) => update("endpoint", value)} /><label><span>Método</span><select value={text("method")} onChange={(event) => update("method", event.target.value)}>{["GET","POST","PUT","PATCH","DELETE","ANY"].map((method) => <option key={method}>{method}</option>)}</select></label></div></section>}
    {collection === "inspectors" && <section><h3>Regra do inspector</h3><div className="qtsEntityFormGrid"><Field label="Padrão do endpoint" value={text("pathPattern")} onChange={(value) => update("pathPattern", value)} help="Ex.: orders ou /api/orders" /><label><span>Método observado</span><select value={text("method")} onChange={(event) => update("method", event.target.value)}>{["ANY","GET","POST","PUT","PATCH","DELETE"].map((method) => <option key={method}>{method}</option>)}</select></label><label><span>Visualização</span><select value={text("visualization")} onChange={(event) => update("visualization", event.target.value)}><option value="friendly">Cards amigáveis</option><option value="table">Tabela</option><option value="tree">Árvore JSON</option><option value="raw">JSON bruto</option></select></label><Field label="Caminho da lista" value={text("listPath")} onChange={(value) => update("listPath", value)} placeholder="data.items" /><Field label="Campos principais" value={Array.isArray(draft.primaryFields) ? draft.primaryFields.join(", ") : ""} onChange={(value) => update("primaryFields", value.split(",").map((item) => item.trim()).filter(Boolean))} wide help="Separe por vírgulas: id, status, total" /><label className="qtsEntityActive"><input type="checkbox" checked={Boolean(draft.enabled)} onChange={(event) => update("enabled", event.target.checked)} /><span><b>Inspector habilitado</b><small>Aparece no menu de ferramentas</small></span></label></div></section>}
    {collection === "resources" && <section><h3>Recurso</h3><div className="qtsEntityFormGrid"><label><span>Tipo</span><select value={text("kind")} onChange={(event) => update("kind", event.target.value)}><option value="link">Link</option><option value="note">Nota</option><option value="json">JSON</option></select></label><Field label="URL" type="url" value={text("url")} onChange={(value) => update("url", value)} /><Field label="Conteúdo" value={text("content")} onChange={(value) => update("content", value)} wide multiline /></div></section>}
    {!(["environments","accounts","paymentMethods","apis","inspectors","resources"] as Collection[]).includes(collection) && <section><h3>Relacionamentos</h3><p className="qtsEntityHint">Os relacionamentos disponíveis são preservados e validados automaticamente. Use a seção avançada somente para vínculos específicos.</p></section>}
  </div>;
}

function Field({ label, value, onChange, type = "text", wide = false, multiline = false, help, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; wide?: boolean; multiline?: boolean; help?: string; placeholder?: string }) {
  return <label className={wide ? "isWide" : ""}><span>{label}</span>{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /> : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}{help && <small>{help}</small>}</label>;
}
