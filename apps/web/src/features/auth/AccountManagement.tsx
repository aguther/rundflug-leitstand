import type { OperatorAccountSummary, OperatorRole } from "@rundflug/contracts";
import { KeyRound, Pencil, Plus, RotateCcw, Search, Trash2, UserRoundCog } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useActionMessageBridge } from "../../app/PageNotifications";
import {
  Button,
  ConfirmationDialog,
  DataTable,
  IconButton,
  ModalDialog,
  SelectField,
  StatusPill,
  TextField,
} from "../../design-system/components";
import { useAuth } from "./AuthContext";
import {
  createManagedAccount,
  deleteManagedAccount,
  loadManagedAccounts,
  roleLabels,
  updateManagedAccount,
} from "./api";
import "./accounts.css";

const assignableRoles: OperatorRole[] = [
  "CASHIER",
  "FLIGHT_LINE",
  "FLIGHT_DIRECTOR",
  "ADMIN",
  "DISPLAY",
];

export function AccountManagement() {
  const { session } = useAuth();
  const [accounts, setAccounts] = useState<OperatorAccountSummary[]>([]);
  const [role, setRole] = useState<OperatorRole>("FLIGHT_LINE");
  const [pin, setPin] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<OperatorAccountSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OperatorAccountSummary | null>(null);
  const [selectedActive, setSelectedActive] = useState(true);
  const [resetPin, setResetPin] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [roleFilter, setRoleFilter] = useState<OperatorRole | "ALL">("ALL");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useActionMessageBridge(message, setMessage);

  const refresh = useCallback(async () => {
    try {
      setAccounts(await loadManagedAccounts());
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Konten sind nicht verfügbar.");
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const visibleAccounts = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase("de-DE");
    return accounts.filter(
      (account) =>
        (roleFilter === "ALL" || account.role === roleFilter) &&
        (!query ||
          `${account.loginCode} ${roleLabels[account.role]}`
            .toLocaleLowerCase("de-DE")
            .includes(query)),
    );
  }, [accounts, deferredSearch, roleFilter]);

  async function createAccount() {
    if (!/^\d{6,12}$/.test(pin) || busyAction) return;
    setBusyAction("create");
    setMessage(null);
    try {
      await createManagedAccount({ role, pin });
      setPin("");
      setCreateOpen(false);
      setMessage("Konto wurde angelegt.");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Konto konnte nicht angelegt werden.");
      throw cause;
    } finally {
      setBusyAction(null);
    }
  }

  function openAccount(account: OperatorAccountSummary) {
    setSelected(account);
    setSelectedActive(account.active);
    setResetPin("");
  }

  async function changeAccount(
    account: OperatorAccountSummary,
    input: { active?: boolean; pin?: string; revokeSessions?: true },
    action: "revoke" | "save",
  ) {
    if (busyAction) return;
    setBusyAction(action);
    setMessage(null);
    try {
      await updateManagedAccount(account.id, input);
      setMessage(
        action === "revoke"
          ? "Aktive Sitzungen wurden widerrufen."
          : "Konto wurde aktualisiert; bestehende Sitzungen wurden widerrufen.",
      );
      if (action === "save") {
        setSelected(null);
        setResetPin("");
      }
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Konto konnte nicht geändert werden.");
      throw cause;
    } finally {
      setBusyAction(null);
    }
  }

  async function saveSelectedAccount() {
    if (!selected) return;
    const input: { active?: boolean; pin?: string } = {};
    if (selected.active !== selectedActive) input.active = selectedActive;
    if (resetPin) input.pin = resetPin;
    if (Object.keys(input).length === 0) {
      setSelected(null);
      return;
    }
    await changeAccount(selected, input, "save");
  }

  async function deleteAccount() {
    if (!deleteTarget || busyAction) return;
    setBusyAction("delete");
    setMessage(null);
    try {
      await deleteManagedAccount(deleteTarget.id);
      setDeleteTarget(null);
      setMessage(`Konto ${deleteTarget.loginCode} wurde gelöscht.`);
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Konto konnte nicht gelöscht werden.");
      throw cause;
    } finally {
      setBusyAction(null);
    }
  }

  const activeAdminCount = accounts.filter(
    (account) => account.role === "ADMIN" && account.active,
  ).length;

  function deletionBlock(account: OperatorAccountSummary): string | null {
    if (account.id === session?.account.id) return "Das aktuell verwendete eigene Konto";
    if (account.role === "ADMIN" && account.active && activeAdminCount <= 1) {
      return "Das letzte aktive Administrationskonto";
    }
    return null;
  }

  const accountColumns = [
    {
      key: "account",
      header: "Konto",
      priority: "primary" as const,
      render: (account: OperatorAccountSummary) => (
        <div className="account-primary-cell">
          <UserRoundCog aria-hidden="true" />
          <div>
            <strong>{account.loginCode}</strong>
            <small className="account-role-inline">{roleLabels[account.role]}</small>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Rolle",
      priority: "secondary" as const,
      render: (account: OperatorAccountSummary) => roleLabels[account.role],
    },
    {
      key: "status",
      header: "Status",
      priority: "primary" as const,
      render: (account: OperatorAccountSummary) => (
        <StatusPill tone={account.active ? "success" : "neutral"}>
          {account.active ? "Aktiv" : "Deaktiviert"}
        </StatusPill>
      ),
    },
  ];

  return (
    <section className="account-management" aria-labelledby="account-management-title">
      <header className="account-management-header">
        <div>
          <div className="account-title-row">
            <h2 id="account-management-title">Konten</h2>
            <span>{accounts.length}</span>
          </div>
          <p>Pseudonyme Zugänge, Rollen und aktive Sitzungen verwalten.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} type="button" variant="primary">
          <Plus aria-hidden="true" /> Konto hinzufügen
        </Button>
      </header>

      <div className="account-table-card">
        <div className="account-table-toolbar">
          <label className="account-search">
            <Search aria-hidden="true" />
            <span className="visually-hidden">Konten durchsuchen</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Konten durchsuchen"
              type="search"
              value={search}
            />
          </label>
          <label className="account-role-filter">
            <span className="visually-hidden">Nach Rolle filtern</span>
            <select
              onChange={(event) => setRoleFilter(event.target.value as OperatorRole | "ALL")}
              value={roleFilter}
            >
              <option value="ALL">Alle Rollen</option>
              {assignableRoles.map((entry) => (
                <option key={entry} value={entry}>
                  {roleLabels[entry]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <DataTable
          className="account-table"
          columns={accountColumns}
          emptyLabel={
            <div className="account-empty">
              <UserRoundCog aria-hidden="true" />
              <strong>
                {accounts.length === 0 ? "Noch keine Konten" : "Keine Konten gefunden"}
              </strong>
              <p>
                {accounts.length === 0
                  ? "Legen Sie den ersten pseudonymen Zugang an."
                  : "Passen Sie Suche oder Rollenfilter an."}
              </p>
              {accounts.length === 0 ? (
                <Button onClick={() => setCreateOpen(true)} type="button" variant="secondary">
                  <Plus aria-hidden="true" /> Erstes Konto hinzufügen
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setSearch("");
                    setRoleFilter("ALL");
                  }}
                  type="button"
                  variant="secondary"
                >
                  Filter zurücksetzen
                </Button>
              )}
            </div>
          }
          pageSize={10}
          renderRowActions={(account) => {
            const deleteBlockedBy = deletionBlock(account);
            return (
              <div className="account-row-actions">
                <IconButton
                  label={`${account.loginCode} bearbeiten`}
                  onClick={() => openAccount(account)}
                  size="touch"
                  type="button"
                >
                  <Pencil aria-hidden="true" />
                </IconButton>
                <IconButton
                  className="account-row-delete"
                  disabled={deleteBlockedBy !== null}
                  label={
                    deleteBlockedBy
                      ? `${deleteBlockedBy} kann nicht gelöscht werden`
                      : `${account.loginCode} löschen`
                  }
                  onClick={() => setDeleteTarget(account)}
                  size="touch"
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                </IconButton>
              </div>
            );
          }}
          rowKey={(account) => account.id}
          rows={visibleAccounts}
        />
      </div>

      <ModalDialog
        className="account-dialog"
        description="Rolle und PIN bilden den pseudonymen Zugang zum Leitstand."
        footer={
          <>
            <Button
              disabled={busyAction !== null}
              onClick={() => setCreateOpen(false)}
              type="button"
              variant="secondary"
            >
              Abbrechen
            </Button>
            <Button
              busy={busyAction === "create"}
              disabled={pin.length < 6 || busyAction !== null}
              onClick={createAccount}
              type="button"
              variant="primary"
            >
              Konto anlegen
            </Button>
          </>
        }
        initialFocusSelector="#new-account-role"
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        size="default"
        title="Konto hinzufügen"
      >
        <div className="account-form-grid">
          <SelectField
            id="new-account-role"
            label="Rolle"
            onChange={(event) => setRole(event.target.value as OperatorRole)}
            value={role}
          >
            {assignableRoles.map((entry) => (
              <option key={entry} value={entry}>
                {roleLabels[entry]}
              </option>
            ))}
          </SelectField>
          <TextField
            help="6–12 Ziffern; wird nicht angezeigt oder protokolliert."
            inputMode="numeric"
            label="Erste PIN"
            maxLength={12}
            minLength={6}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            pattern="[0-9]{6,12}"
            placeholder="6–12 Ziffern"
            type="password"
            value={pin}
          />
        </div>
      </ModalDialog>

      <ModalDialog
        className="account-dialog"
        description="Änderungen widerrufen bestehende Sitzungen entsprechend der Kontenrichtlinie."
        footer={
          <>
            <Button
              disabled={busyAction !== null}
              onClick={() => setSelected(null)}
              type="button"
              variant="secondary"
            >
              Abbrechen
            </Button>
            <Button
              busy={busyAction === "save"}
              disabled={busyAction !== null || (resetPin.length > 0 && resetPin.length < 6)}
              onClick={saveSelectedAccount}
              type="button"
              variant="primary"
            >
              Änderungen speichern
            </Button>
          </>
        }
        onClose={() => setSelected(null)}
        open={selected !== null}
        size="default"
        title="Konto bearbeiten"
      >
        {selected ? (
          <div className="account-edit-content">
            <div className="account-form-grid">
              <TextField disabled label="Kontokennung" value={selected.loginCode} />
              <TextField disabled label="Rolle" value={roleLabels[selected.role]} />
              <SelectField
                label="Status"
                onChange={(event) => setSelectedActive(event.target.value === "ACTIVE")}
                value={selectedActive ? "ACTIVE" : "INACTIVE"}
              >
                <option value="ACTIVE">Aktiv</option>
                <option value="INACTIVE">Deaktiviert</option>
              </SelectField>
              <TextField
                help="Leer lassen, um die PIN nicht zu verändern."
                inputMode="numeric"
                label="Neue PIN"
                maxLength={12}
                minLength={6}
                onChange={(event) => setResetPin(event.target.value.replace(/\D/g, ""))}
                pattern="[0-9]{6,12}"
                placeholder="6–12 Ziffern"
                type="password"
                value={resetPin}
              />
            </div>
            <section className="account-security-actions">
              <div>
                <KeyRound aria-hidden="true" />
                <div>
                  <strong>PIN &amp; Sitzungen</strong>
                  <p>Aktive Sitzungen können unabhängig von anderen Änderungen beendet werden.</p>
                </div>
              </div>
              <Button
                busy={busyAction === "revoke"}
                disabled={busyAction !== null}
                onClick={() => void changeAccount(selected, { revokeSessions: true }, "revoke")}
                type="button"
                variant="secondary"
              >
                <RotateCcw aria-hidden="true" /> Sitzungen widerrufen
              </Button>
            </section>
          </div>
        ) : null}
      </ModalDialog>

      <ConfirmationDialog
        body={
          <div className="account-delete-copy">
            <p>
              Das Konto <strong>{deleteTarget?.loginCode}</strong> wird aus Anmeldung und Verwaltung
              entfernt.
            </p>
            <p>
              Aktive Sitzungen werden beendet. Die Kontokennung bleibt intern reserviert und wird
              nicht erneut vergeben.
            </p>
          </div>
        }
        confirmBusy={busyAction === "delete"}
        confirmDisabled={busyAction !== null && busyAction !== "delete"}
        confirmLabel="Konto endgültig löschen"
        danger
        onCancel={() => {
          if (!busyAction) setDeleteTarget(null);
        }}
        onConfirm={deleteAccount}
        open={deleteTarget !== null}
        title="Konto löschen"
      />
    </section>
  );
}
