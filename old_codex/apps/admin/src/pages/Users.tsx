import { useEffect, useState } from "react";
import { adminApi, type AdminUserRow, type Plan, type UserAccessSnapshot } from "../services/adminApi";
import { describeApiError } from "../App";

export function Users() {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedEmail, setSelectedEmail] = useState("");
  const [detail, setDetail] = useState<UserAccessSnapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  const [grantPlanId, setGrantPlanId] = useState("");
  const [grantSource, setGrantSource] = useState<"manual" | "founder">("manual");
  const [grantExpiresAt, setGrantExpiresAt] = useState("");
  const [grantReason, setGrantReason] = useState("");

  const [licensePlanId, setLicensePlanId] = useState("");
  const [licenseActivations, setLicenseActivations] = useState("1");
  const [licenseReason, setLicenseReason] = useState("");
  const [issuedLicenseKey, setIssuedLicenseKey] = useState("");

  const loadUsers = (query?: string) => {
    setLoading(true);
    Promise.all([adminApi.searchUsers(query), adminApi.catalog()])
      .then(([userData, catalog]) => {
        setRows(userData.users);
        setPlans(catalog.plans);
        if (!grantPlanId && catalog.plans[0]) setGrantPlanId(catalog.plans[0].id);
        if (!licensePlanId && catalog.plans[0]) setLicensePlanId(catalog.plans[0].id);
      })
      .catch((thrown) => setError(describeApiError(thrown)))
      .finally(() => setLoading(false));
  };

  useEffect(() => loadUsers(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const openUser = (email: string) => {
    setSelectedEmail(email);
    setError(""); setNotice("");
    adminApi.listUserAccess(email).then(setDetail).catch((thrown) => setError(describeApiError(thrown)));
  };

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setError(""); setNotice("");
    try {
      await action();
      setNotice(successMessage);
      if (selectedEmail) openUser(selectedEmail);
    } catch (thrown) {
      setError(describeApiError(thrown));
    }
  };

  return (
    <section className="adminSection">
      <header className="adminSectionHead">
        <h2>Usuários e acesso</h2>
        <p>Concessão/revogação de acesso é sempre auditada e nunca decidida pelo cliente — a fonte é o backend.</p>
      </header>
      {error ? <p className="adminError">{error}</p> : null}
      {notice ? <p className="adminNotice">{notice}</p> : null}

      <form
        className="adminToolbar"
        onSubmit={(event) => { event.preventDefault(); loadUsers(search); }}
      >
        <input placeholder="Buscar por e-mail…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button type="submit" className="adminButton">Buscar</button>
      </form>

      <div className="adminGrid2">
        <div className="adminPanel">
          <h3>Resultados</h3>
          <div className="adminTableWrap">
            <table className="adminTable">
              <thead><tr><th>E-mail</th><th>Plano</th><th>Origem</th><th>Roles</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={row.email === selectedEmail ? "isSelected" : ""}>
                    <td>
                      <button type="button" className="adminLinkButton" onClick={() => row.email && openUser(row.email)}>
                        {row.email ?? row.id}
                      </button>
                    </td>
                    <td>{row.plan_key ?? "—"}</td>
                    <td>{row.access_source ?? "—"}</td>
                    <td>{row.roles.join(", ") || "user"}</td>
                  </tr>
                ))}
                {!rows.length && !loading ? <tr><td colSpan={4} className="adminEmptyCell">Nenhum usuário encontrado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="adminPanel">
          <h3>Detalhe {selectedEmail ? `— ${selectedEmail}` : ""}</h3>
          {!detail ? <p className="adminMuted">Selecione um usuário na lista.</p> : (
            <>
              <h4 className="adminMicroHeading">Assinatura</h4>
              <p className="adminMuted">
                {detail.subscription ? `${detail.subscription.plans?.key ?? "?"} · ${detail.subscription.status}` : "Sem assinatura Stripe ativa."}
              </p>

              <h4 className="adminMicroHeading">Concessões de acesso</h4>
              <table className="adminTable">
                <thead><tr><th>Plano</th><th>Origem</th><th>Expira</th><th>Status</th><th>Ação</th></tr></thead>
                <tbody>
                  {detail.grants.map((grant) => (
                    <tr key={grant.id}>
                      <td>{grant.plans?.key ?? "—"}</td>
                      <td>{grant.source}</td>
                      <td>{grant.expires_at ? new Date(grant.expires_at).toLocaleDateString("pt-BR") : "Vitalício"}</td>
                      <td>{grant.revoked_at ? "Revogado" : "Ativo"}</td>
                      <td>
                        {!grant.revoked_at ? (
                          <button
                            type="button"
                            className="adminButton adminButton-small"
                            onClick={() => void run(() => adminApi.revokeAccess({ grantId: grant.id, reason: "Revogado pelo painel admin" }), "Acesso revogado.")}
                          >
                            Revogar
                          </button>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                  {!detail.grants.length ? <tr><td colSpan={5} className="adminEmptyCell">Nenhuma concessão.</td></tr> : null}
                </tbody>
              </table>
              <form
                className="adminInlineForm"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(() => adminApi.grantAccess({
                    userEmail: selectedEmail, planId: grantPlanId, source: grantSource,
                    expiresAt: grantExpiresAt ? new Date(grantExpiresAt).toISOString() : null, reason: grantReason,
                  }), "Acesso concedido.");
                  setGrantExpiresAt(""); setGrantReason("");
                }}
              >
                <select value={grantPlanId} onChange={(event) => setGrantPlanId(event.target.value)}>
                  {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.key}</option>)}
                </select>
                <select value={grantSource} onChange={(event) => setGrantSource(event.target.value as "manual" | "founder")}>
                  <option value="manual">Manual</option>
                  <option value="founder">Founder (vitalício recomendado)</option>
                </select>
                <input type="date" value={grantExpiresAt} onChange={(event) => setGrantExpiresAt(event.target.value)} placeholder="Vazio = vitalício" />
                <input placeholder="Motivo (mín. 10 caracteres)" value={grantReason} onChange={(event) => setGrantReason(event.target.value)} required minLength={10} />
                <button type="submit" className="adminButton adminButton-primary">Conceder acesso</button>
              </form>

              <h4 className="adminMicroHeading">Chave de licença</h4>
              <form
                className="adminInlineForm"
                onSubmit={(event) => {
                  event.preventDefault();
                  setError(""); setNotice(""); setIssuedLicenseKey("");
                  adminApi.createLicenseKey({ planId: licensePlanId, maximumActivations: Number(licenseActivations), expiresAt: null, reason: licenseReason })
                    .then((result) => { setIssuedLicenseKey(result.plainKey); setNotice("Licença criada — copie a chave agora, ela não será mostrada novamente."); })
                    .catch((thrown) => setError(describeApiError(thrown)));
                }}
              >
                <select value={licensePlanId} onChange={(event) => setLicensePlanId(event.target.value)}>
                  {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.key}</option>)}
                </select>
                <input placeholder="Máx. ativações" value={licenseActivations} onChange={(event) => setLicenseActivations(event.target.value)} inputMode="numeric" required />
                <input placeholder="Motivo" value={licenseReason} onChange={(event) => setLicenseReason(event.target.value)} required minLength={10} />
                <button type="submit" className="adminButton adminButton-primary">Gerar chave</button>
              </form>
              {issuedLicenseKey ? <p className="adminMonoCell adminIssuedKey">{issuedLicenseKey}</p> : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
