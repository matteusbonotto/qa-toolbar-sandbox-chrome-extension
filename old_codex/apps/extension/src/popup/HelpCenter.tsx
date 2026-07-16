import { useMemo, useState } from "react";
import { FiCheck, FiClipboard, FiExternalLink, FiSearch, FiShield } from "react-icons/fi";
import type { EntitlementCache } from "../services/entitlements";

const faq = [
  ["Primeiros passos", "Como começo?", "Conclua o assistente, cadastre os padrões de URL e abra uma página compatível. A toolbar aparece somente nos endereços autorizados."],
  ["Permissões", "Por que a extensão pede acesso ao site?", "O acesso é solicitado para montar a toolbar, capturar a aba e observar requisições. Permissões opcionais são pedidas apenas no momento de uso."],
  ["Gravação", "MP4 não está disponível. O que acontece?", "A extensão testa os codecs do navegador e usa WebM automaticamente quando MP4 não for suportado."],
  ["Convertio", "Meu vídeo é enviado automaticamente?", "Não. O envio à Convertio ocorre somente depois de você solicitar GIF e aceitar o processamento externo."],
  ["Breakpoint Viewer", "Ele substitui um dispositivo real?", "Não. Ele simula dimensões responsivas. Hardware, sistema operacional e navegador móvel ainda precisam de validação real."],
  ["Contas", "Posso guardar credenciais reais?", "Não recomendamos. Cadastre somente contas de sandbox. A exportação segura exclui campos sensíveis."],
  ["Pagamentos sandbox", "Posso usar cartão real?", "Não. Use apenas números e cenários oficiais do ambiente de testes do seu provedor."],
  ["Network Observatory", "Por que algumas respostas não aparecem?", "Metadados de rede ficam disponíveis pela Performance API. Payloads exigem ativação explícita e respeitam limites e redaction."],
  ["Inspectors", "Como um endpoint é identificado?", "Cadastre o nome do endpoint nas configurações. A extensão mostra somente respostas compatíveis observadas nesta página."],
  ["Planos e licenças", "O que ocorre quando o acesso expira?", "Recursos premium são bloqueados, mas seus dados locais permanecem preservados."],
  ["Importação e exportação", "Como desfazer uma importação?", "A importação cria rollback antes de aplicar merge ou substituição. Use a exportação segura para compartilhar configurações."],
  ["Privacidade", "Onde meus dados ficam?", "Configurações são local-first. Supabase recebe apenas dados necessários de conta, acesso e billing; Stripe processa pagamentos."],
  ["Troubleshooting", "A toolbar não apareceu", "Confirme o padrão de URL, a permissão do site, se a extensão está ativa e recarregue a aba."],
] as const;

export function HelpCenter({ mode, entitlement, signedIn, locale }: { mode: "faq" | "about"; entitlement: EntitlementCache | null; signedIn: boolean; locale: string }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => faq.filter((row) => row.join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query]);
  if (mode === "faq") return <section className="qtsHelpCenter"><label><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar no FAQ offline" /></label><div>{filtered.map(([category, question, answer]) => <details key={question}><summary><small>{category}</small>{question}</summary><p>{answer}</p></details>)}</div>{!filtered.length && <p>Nenhuma resposta encontrada.</p>}</section>;
  const manifest = browser.runtime.getManifest();
  const diagnostic = { application: manifest.name, version: manifest.version, build: import.meta.env.MODE, browser: navigator.userAgent.replace(/\([^)]*\)/g, "(redacted)"), locale, online: navigator.onLine, signedIn, plan: entitlement?.plan.name ?? "Starter", accessStatus: entitlement ? (entitlement.access.active ? "active" : "inactive") : "local", generatedAt: new Date().toISOString() };
  return <section className="qtsAbout"><FiShield /><h2>QA Toolbar Sandbox</h2><p>Ferramentas local-first para organizar dados de teste, observar aplicações e gerar evidências diretamente no navegador.</p><dl><div><dt>Versão</dt><dd>{manifest.version}</dd></div><div><dt>Build</dt><dd>{import.meta.env.MODE}</dd></div><div><dt>Desenvolvedor</dt><dd>Matheus Bonotto</dd></div><div><dt>Idioma</dt><dd>{locale}</dd></div><div><dt>Conexão</dt><dd>{navigator.onLine ? "Online" : "Offline"}</dd></div><div><dt>Licença</dt><dd>{diagnostic.plan} · {diagnostic.accessStatus}</dd></div></dl><div className="qtsAboutActions"><a href="https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/privacy-policy/" target="_blank" rel="noreferrer">Privacidade <FiExternalLink /></a><a href="https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/terms/" target="_blank" rel="noreferrer">Termos <FiExternalLink /></a><a href="https://github.com/matteusbonotto/qa-toolbar-sandbox-chrome-extension/issues" target="_blank" rel="noreferrer">Suporte <FiExternalLink /></a><button onClick={() => void navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2))}><FiClipboard /> Copiar diagnóstico seguro</button></div><p><FiCheck /> O diagnóstico não inclui tokens, chaves, URLs internas nem credenciais.</p></section>;
}
