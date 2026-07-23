import { useEffect, useRef, useState } from "react";
import { BrandMark } from "../../design-system/BrandMark";
import { Button } from "../../design-system/components";
import { ThemeToggle } from "../../design-system/ThemeToggle";
import { useAuth } from "./AuthContext";
import {
  type LoginAccount,
  loadLoginAccounts,
  loginOperator,
  loginRoleOrder,
  roleLabels,
} from "./api";
import "./login.css";

export function LoginPage() {
  const { setSession, unavailable, refresh } = useAuth();
  const [accounts, setAccounts] = useState<LoginAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountRef = useRef<HTMLSelectElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadLoginAccounts()
      .then((loaded) => {
        setAccounts(loaded);
        if (loaded.length === 1) setAccountId(loaded[0]?.id ?? "");
      })
      .catch(() => setError("Anmeldung ist momentan nicht verfügbar."));
  }, []);
  useEffect(() => accountRef.current?.focus(), []);
  useEffect(() => {
    if (accountId) pinRef.current?.focus();
  }, [accountId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!accountId || !/^\d{6,12}$/.test(pin) || busy) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await loginOperator(accountId, pin));
    } catch {
      setPin("");
      setError("Konto oder PIN ist nicht gültig.");
      requestAnimationFrame(() => pinRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  async function retryConnection() {
    setRefreshBusy(true);
    try {
      await refresh();
    } finally {
      setRefreshBusy(false);
    }
  }

  return (
    <main className="login-page">
      <header className="login-topbar">
        <a className="app-brand" href="/" aria-label="Rundflug-Leitstand">
          <BrandMark />
          <strong>Rundflug-Leitstand</strong>
        </a>
        <ThemeToggle />
      </header>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-heading">
          <BrandMark />
          <div>
            <h1 id="login-title">Anmelden</h1>
            <p>Konto auswählen und persönliche PIN eingeben.</p>
          </div>
        </div>
        {unavailable ? (
          <div className="login-message login-message-error" role="alert">
            <span>Server nicht erreichbar.</span>
            <Button
              busy={refreshBusy}
              type="button"
              onClick={() => void retryConnection()}
              variant="secondary"
            >
              Erneut prüfen
            </Button>
          </div>
        ) : null}
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="login-account">Konto</label>
          <select
            ref={accountRef}
            id="login-account"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">Konto auswählen</option>
            {loginRoleOrder.map((role) => {
              const roleAccounts = accounts.filter((account) => account.role === role);
              if (roleAccounts.length === 0) return null;
              return (
                <optgroup key={role} label={roleLabels[role]}>
                  {roleAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.loginCode}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <label htmlFor="login-pin">PIN</label>
          <input
            ref={pinRef}
            id="login-pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            pattern="[0-9]{6,12}"
            minLength={6}
            maxLength={12}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            placeholder="6–12 Ziffern"
          />
          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            busy={busy}
            className="login-submit"
            type="submit"
            disabled={!accountId || pin.length < 6}
            variant="primary"
          >
            Anmelden
          </Button>
        </form>
        <p className="login-privacy">Keine Namen · keine personenbezogenen Profile</p>
      </section>
    </main>
  );
}
