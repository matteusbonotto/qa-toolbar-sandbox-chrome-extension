import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FiActivity, FiCheck, FiDownload, FiGlobe, FiLock, FiSettings, FiShield, FiUpload, FiZap } from "react-icons/fi";
import { z } from "zod";
import { workspaceImportSchema } from "@qts/domain";

const setupSchema = z.object({
  projectName: z.string().trim().min(2, "Use at least 2 characters").max(80),
  domain: z.string().trim().min(1).refine((value) => /^[a-z0-9.-]+$/i.test(value), "Enter a hostname without protocol"),
  environmentName: z.string().trim().min(1).max(48),
});

type SetupValues = z.infer<typeof setupSchema>;

export function OptionsApp() {
  const [saved, setSaved] = useState(false);
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { projectName: "My web app", domain: "localhost", environmentName: "Local" },
  });

  useEffect(() => {
    void browser.storage.local.get("qtsSetup").then(({ qtsSetup }) => {
      if (qtsSetup) reset(qtsSetup as SetupValues);
    });
  }, [reset]);

  const save = handleSubmit(async (values) => {
    await browser.storage.local.set({ qtsSetup: values });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  });

  const importWorkspace = async (file: File | undefined) => {
    if (!file) return;
    setImportMessage("");
    try {
      if (file.size > 262_144) throw new Error("O arquivo deve ter no máximo 256 KB.");
      const parsed = workspaceImportSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error("Formato de workspace inválido ou incompatível.");
      const origins = parsed.data.setup.domains
        .filter((domain) => domain !== "localhost" && domain !== "127.0.0.1")
        .map((domain) => `*://${domain}/*`);
      if (origins.length && !await browser.permissions.request({ origins })) {
        throw new Error("A permissão para o domínio do mock não foi concedida.");
      }
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
      await browser.storage.local.set({
        qtsSetup: parsed.data.setup,
        qtsProjects: parsed.data.projects,
        qtsActiveProjectId: parsed.data.activeProjectId,
      });
      reset(parsed.data.setup);
      setImportMessage(`${parsed.data.projects[0]?.environments.length ?? 0} ambientes importados. Recarregue o site de demonstração.`);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Não foi possível importar o workspace.");
    }
  };

  return (
    <div className="qtsOptionsShell">
      <aside className="qtsSideNav">
        <div className="qtsBrand"><span><FiZap /></span><div><small>QA TOOLBAR</small><strong>Sandbox</strong></div></div>
        <nav aria-label="Settings sections">
          <a className="isActive" href="#workspace"><FiGlobe />Workspace</a>
          <a href="#privacy"><FiShield />Privacy</a>
          <a href="#settings"><FiSettings />Preferences</a>
        </nav>
        <div className="qtsLocalBadge"><FiLock /><span><strong>Local-first</strong><small>No operational data sync</small></span></div>
      </aside>

      <main className="qtsOptionsMain">
        <header className="qtsOptionsHeader"><div><span>FOUNDATION · PHASE 1</span><h1>Make this browser<br /><i>your QA cockpit.</i></h1><p>Connect one local project and preview the extension without granting broad site access.</p></div><div className="qtsOrb"><FiActivity /></div></header>

        <form id="workspace" className="qtsSetupCard" onSubmit={save}>
          <div className="qtsCardTitle"><span>01</span><div><h2>Project context</h2><p>These values stay in <code>browser.storage.local</code>.</p></div></div>
          <div className="qtsFormGrid">
            <label><span>Project name</span><input {...register("projectName")} aria-invalid={Boolean(errors.projectName)} />{errors.projectName && <small>{errors.projectName.message}</small>}</label>
            <label><span>Environment</span><input {...register("environmentName")} aria-invalid={Boolean(errors.environmentName)} />{errors.environmentName && <small>{errors.environmentName.message}</small>}</label>
            <label className="isWide"><span>Project hostname</span><div className="qtsDomainInput"><FiGlobe /><input {...register("domain")} aria-invalid={Boolean(errors.domain)} /></div>{errors.domain && <small>{errors.domain.message}</small>}</label>
          </div>
          <footer><div className="qtsSafety"><FiShield /><span><strong>Least privilege by design</strong><small>This setup does not request access to every website.</small></span></div><button type="submit" disabled={isSubmitting} className={saved ? "isSaved" : ""}>{saved ? <><FiCheck /> Saved locally</> : "Save workspace"}</button></footer>
        </form>

        <section id="privacy" className="qtsCaptureCard">
          <div><span className={`qtsCaptureDot ${captureEnabled ? "isLive" : ""}`}><FiActivity /></span><div><h2>Network Observatory</h2><p>Live interception is intentionally disabled in this foundation cut. <a href="https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/privacy-policy/" target="_blank" rel="noreferrer">Política de Privacidade</a></p></div></div>
          <button type="button" aria-pressed={captureEnabled} onClick={() => setCaptureEnabled((value) => !value)}><span />{captureEnabled ? "Preview active" : "Preview capture"}</button>
        </section>

        <section className="qtsImportCard">
          <div><span className="qtsCaptureDot"><FiUpload /></span><div><h2>Importar dados para demonstração</h2><p>Carregue um JSON validado para preparar screenshots sem usar dados reais.</p></div></div>
          <div className="qtsImportActions">
            <label className="qtsImportButton"><FiUpload /> Importar JSON<input type="file" accept="application/json,.json" onChange={(event) => { void importWorkspace(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
            <a href={browser.runtime.getURL("/examples/qa-toolbar-demo-workspace.json")} download><FiDownload /> Baixar mock</a>
          </div>
          {importMessage && <small className="qtsImportMessage" role="status">{importMessage}</small>}
        </section>
      </main>
    </div>
  );
}
