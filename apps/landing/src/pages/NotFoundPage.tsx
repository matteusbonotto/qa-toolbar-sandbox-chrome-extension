import { useI18n } from "../i18n/I18nProvider";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <main className="qts-container" style={{ minHeight: "70vh", display: "grid", placeContent: "center", textAlign: "center" }}>
      <span className="qts-eyebrow">404</span>
      <h1>{t.notFound.title}</h1>
      <p className="qts-section-lead">{t.notFound.body}</p>
      <a className="qts-btn qts-btn-primary" href={import.meta.env.BASE_URL}>{t.notFound.back}</a>
    </main>
  );
}
