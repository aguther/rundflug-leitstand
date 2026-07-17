import type { OperatorAccountSummary, OperatorRole } from "@rundflug/contracts";
import { useCallback, useEffect, useState } from "react";
import { createManagedAccount, loadManagedAccounts, roleLabels, updateManagedAccount } from "./api";
import "./accounts.css";

const assignableRoles: OperatorRole[] = [
  "CASHIER",
  "FLIGHT_LINE",
  "FLIGHT_LINE_LEAD",
  "FLIGHT_DIRECTOR",
  "ADMIN",
  "DISPLAY",
];

export function AccountManagement() {
  const [accounts, setAccounts] = useState<OperatorAccountSummary[]>([]);
  const [role, setRole] = useState<OperatorRole>("FLIGHT_LINE");
  const [pin, setPin] = useState("");
  const [selected, setSelected] = useState<OperatorAccountSummary | null>(null);
  const [resetPin, setResetPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAccounts(await loadManagedAccounts());
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Konten sind nicht verfügbar.");
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6,12}$/.test(pin) || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await createManagedAccount({ role, pin });
      setPin("");
      setMessage("Konto wurde angelegt.");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Konto konnte nicht angelegt werden.");
    } finally {
      setBusy(false);
    }
  }

  async function changeAccount(
    account: OperatorAccountSummary,
    input: { active?: boolean; pin?: string },
  ) {
    setBusy(true);
    setMessage(null);
    try {
      await updateManagedAccount(account.id, input);
      setSelected(null);
      setResetPin("");
      setMessage("Konto wurde aktualisiert; bestehende Sitzungen wurden widerrufen.");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Konto konnte nicht geändert werden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-management" aria-labelledby="account-management-title">
      <header>
        <div>
          <h1 id="account-management-title">Konten</h1>
          <p>Pseudonyme Arbeitskonten mit Rolle und sechsstelliger PIN.</p>
        </div>
      </header>
      <div className="account-layout">
        <div className="account-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Konto</th>
                <th>Rolle</th>
                <th>Status</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <strong>{account.loginCode}</strong>
                  </td>
                  <td>{roleLabels[account.role]}</td>
                  <td>
                    <span className={`account-status ${account.active ? "active" : "inactive"}`}>
                      {account.active ? "Aktiv" : "Inaktiv"}
                    </span>
                  </td>
                  <td>
                    <button type="button" onClick={() => setSelected(account)}>
                      Bearbeiten
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="account-editor" onSubmit={(event) => void createAccount(event)}>
          <h2>Neues Konto</h2>
          <label>
            Rolle
            <select value={role} onChange={(event) => setRole(event.target.value as OperatorRole)}>
              {assignableRoles.map((entry) => (
                <option key={entry} value={entry}>
                  {roleLabels[entry]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Erste PIN
            <input
              inputMode="numeric"
              maxLength={12}
              minLength={6}
              pattern="[0-9]{6,12}"
              type="password"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              placeholder="6–12 Ziffern"
            />
          </label>
          <button className="primary-action" disabled={pin.length < 6 || busy} type="submit">
            Konto anlegen
          </button>
        </form>
      </div>
      {message ? (
        <p className="account-message" role="status">
          {message}
        </p>
      ) : null}
      {selected ? (
        <div className="modal-backdrop">
          <form
            className="confirmation-dialog account-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              if (resetPin.length >= 6) void changeAccount(selected, { pin: resetPin });
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-dialog-title"
          >
            <header>
              <div>
                <h2 id="account-dialog-title">{selected.loginCode}</h2>
                <p>{roleLabels[selected.role]}</p>
              </div>
              <button aria-label="Schließen" onClick={() => setSelected(null)} type="button">
                ×
              </button>
            </header>
            <label>
              Neue PIN
              <input
                inputMode="numeric"
                pattern="[0-9]{6,12}"
                type="password"
                value={resetPin}
                onChange={(event) => setResetPin(event.target.value.replace(/\D/g, ""))}
                placeholder="6–12 Ziffern"
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                onClick={() => void changeAccount(selected, { active: !selected.active })}
              >
                {selected.active ? "Deaktivieren" : "Aktivieren"}
              </button>
              <button
                className="primary-action"
                disabled={resetPin.length < 6 || busy}
                type="submit"
              >
                PIN ändern
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
