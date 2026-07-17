import { useState } from "react";
import { grantRole, listProfiles, listRoles, listUserRoles, revokeRole } from "../lib/api";
import { useAsyncData } from "../lib/useAsyncData";
import { useAuth } from "../lib/AuthProvider";

export function UsersPage() {
  const { user } = useAuth();
  const profiles = useAsyncData(listProfiles);
  const roles = useAsyncData(listRoles);
  const userRoles = useAsyncData(listUserRoles);

  const [targetUserId, setTargetUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const rolesByUser = (userRoles.data ?? []).reduce<Record<string, string[]>>((acc, ur) => {
    const role = (roles.data ?? []).find((r) => r.id === ur.role_id);
    if (!role) return acc;
    (acc[ur.user_id] ??= []).push(role.key);
    return acc;
  }, {});

  async function handleGrant(event: React.FormEvent) {
    event.preventDefault();
    if (!targetUserId.trim() || !roleId || !reason.trim() || !user) return;
    setBusy(true);
    setFormError(null);
    try {
      await grantRole(targetUserId.trim(), roleId, user.id, reason.trim());
      setTargetUserId("");
      setReason("");
      userRoles.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="qa-page-head">
        <h1>Usuários e roles</h1>
        <p>
          A role <code>founder</code> nunca deve ser concedida por aqui em produção — o schema
          bloqueia isso por trigger (admins não concedem founder, usuários não alteram a própria
          role). Use esta tela para roles operacionais (ex.: <code>support</code>).
        </p>
      </header>

      <div className="qa-card">
        <h2>Conceder role</h2>
        {formError ? <div className="qa-error">{formError}</div> : null}
        <form className="qa-form-row" onSubmit={handleGrant}>
          <input placeholder="User ID" value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)} />
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">Role…</option>
            {(roles.data ?? [])
              .filter((role) => role.key !== "founder")
              .map((role) => (
                <option key={role.id} value={role.id}>
                  {role.key}
                </option>
              ))}
          </select>
          <input placeholder="Motivo (obrigatório, vai para audit_logs)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="submit" className="qa-btn primary" disabled={busy}>
            + Conceder
          </button>
        </form>
      </div>

      <div className="qa-card">
        <h2>Usuários</h2>
        {profiles.error ? <div className="qa-error">{profiles.error}</div> : null}
        {!profiles.loading && !(profiles.data ?? []).length ? <div className="qa-empty">Nenhum usuário ainda.</div> : null}
        {(profiles.data ?? []).length ? (
          <table className="qa-table">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Nome</th>
                <th>Roles</th>
                <th>Trial até</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(profiles.data ?? []).map((profile) => (
                <tr key={profile.id}>
                  <td title={profile.id}>{profile.email ?? `${profile.id.slice(0, 8)}…`}</td>
                  <td>{profile.display_name ?? "—"}</td>
                  <td>{(rolesByUser[profile.id] ?? []).join(", ") || "—"}</td>
                  <td>{profile.trial_ends_at ? new Date(profile.trial_ends_at).toLocaleDateString("pt-BR") : "—"}</td>
                  <td>
                    {(rolesByUser[profile.id] ?? [])
                      .filter((key) => key !== "founder")
                      .map((key) => {
                        const role = (roles.data ?? []).find((r) => r.key === key);
                        if (!role) return null;
                        return (
                          <button
                            key={key}
                            type="button"
                            className="qa-btn danger"
                            style={{ marginRight: 6 }}
                            onClick={() => revokeRole(profile.id, role.id).then(userRoles.reload)}
                          >
                            Remover {key}
                          </button>
                        );
                      })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
