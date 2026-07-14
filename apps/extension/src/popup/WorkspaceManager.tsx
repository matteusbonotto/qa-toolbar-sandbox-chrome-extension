import { useEffect, useMemo, useState } from "react";
import { FiCopy, FiEdit2, FiPlus, FiSearch, FiTrash2 } from "react-icons/fi";
import { localWorkspaceSchema, type LocalWorkspace } from "@qts/domain";
import { emptyWorkspace } from "../services/localWorkspace";

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
          headers: {},
        },
        inspectors: {
          ...common,
          apiId: workspace.apis[0]?.id ?? null,
          pathPattern: value.toLowerCase().replace(/\s+/g, "-"),
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
  return (
    <section className="qtsWorkspaceManager">
      <header>
        <div>
          <h2>Workspace e CRUDs</h2>
          <p>Dados locais validados pelo schema v2.</p>
        </div>
        <select
          value={collection}
          onChange={(event) => setCollection(event.target.value as Collection)}
        >
          {collections.map((key) => (
            <option value={key} key={key}>
              {labels[key]}
            </option>
          ))}
        </select>
      </header>
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
          placeholder="Nome do novo item"
        />
        <button onClick={() => void create()}>
          <FiPlus /> Criar
        </button>
      </div>
      <div className="qtsCrudList">
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
              onClick={() => {
                const updated = window.prompt("Novo nome", item.name);
                if (updated?.trim())
                  void patchEntity(
                    item.id,
                    {
                      name: updated.trim(),
                      shortName: updated.trim().slice(0, 20),
                    },
                    "Item editado.",
                  );
              }}
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
    </section>
  );
}
