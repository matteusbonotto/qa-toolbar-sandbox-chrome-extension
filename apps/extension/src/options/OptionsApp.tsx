import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FiActivity, FiCheck, FiGlobe, FiLock, FiSettings, FiShield, FiZap } from "react-icons/fi";
import { z } from "zod";

const setupSchema = z.object({
  projectName: z.string().trim().min(2, "Use at least 2 characters").max(80),
  domain: z.string().trim().min(1).refine((value) => /^[a-z0-9.-]+$/i.test(value), "Enter a hostname without protocol"),
  environmentName: z.string().trim().min(1).max(48),
});

type SetupValues = z.infer<typeof setupSchema>;

export function OptionsApp() {
  const [saved, setSaved] = useState(false);
  const [captureEnabled, setCaptureEnabled] = useState(false);
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
          <div><span className={`qtsCaptureDot ${captureEnabled ? "isLive" : ""}`}><FiActivity /></span><div><h2>Network Observatory</h2><p>Live interception is intentionally disabled in this foundation cut.</p></div></div>
          <button type="button" aria-pressed={captureEnabled} onClick={() => setCaptureEnabled((value) => !value)}><span />{captureEnabled ? "Preview active" : "Preview capture"}</button>
        </section>
      </main>
    </div>
  );
}
