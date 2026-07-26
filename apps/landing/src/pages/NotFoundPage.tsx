export function NotFoundPage() {
  return (
    <main className="qts-container" style={{ minHeight: "70vh", display: "grid", placeContent: "center", textAlign: "center" }}>
      <span className="qts-eyebrow">404</span>
      <h1>Página não encontrada</h1>
      <p className="qts-section-lead">O endereço informado não existe ou foi movido.</p>
      <a className="qts-btn qts-btn-primary" href={import.meta.env.BASE_URL}>Voltar ao início</a>
    </main>
  );
}
