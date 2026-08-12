import { useEffect, useState } from "react";
import { bootstrapSystem, getSetupStatus } from "./api";
import { AppShell as Shell } from "./app/AppShell";
import { useActionMessageBridge } from "./app/PageNotifications";
import { Button } from "./design-system/components";
import { rememberActiveEvent } from "./event-context";
import { eventDateInTimeZone } from "./event-time";
import { LocalizedDateInput } from "./localized-date-input";
import { setupValidationMessages } from "./setup-validation";
import "./features/auth/setup.css";

export function SetupView() {
  const [status, setStatus] = useState<{
    setupRequired: boolean;
    setupConfigured: boolean;
    resetSetupAuthorized: boolean;
    resetSetupExpiresAt: string | null;
  } | null>(null);
  const [eventId, setEventId] = useState(`rundflug-${new Date().getFullYear()}`);
  const [name, setName] = useState(`Rundflug ${new Date().getFullYear()}`);
  const [eventDate, setEventDate] = useState(eventDateInTimeZone(new Date(), "Europe/Berlin"));
  const [aerodrome, setAerodrome] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  useActionMessageBridge(message, setMessage);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getSetupStatus()
      .then(setStatus)
      .catch((cause) =>
        setMessage(cause instanceof Error ? cause.message : "Einrichtungsstatus nicht verfügbar."),
      );
  }, []);

  async function submitSetup() {
    if (busy) return;
    const validationMessages = setupValidationMessages(
      {
        eventId,
        name,
        eventDate,
        aerodrome,
        setupCode,
        adminPin,
      },
      { requireSetupCode: status?.resetSetupAuthorized !== true },
    );
    if (validationMessages.length > 0) {
      setMessage(validationMessages.join(" "));
      return;
    }
    setBusy(true);
    try {
      const result = await bootstrapSystem({
        ...(status?.resetSetupAuthorized ? {} : { setupCode }),
        adminPin,
        eventId: eventId.trim(),
        name: name.trim(),
        eventDate,
        aerodrome: aerodrome.trim(),
        timeZone: "Europe/Berlin",
      });
      rememberActiveEvent(window.localStorage, result.eventId);
      window.location.assign(`/admin?event=${encodeURIComponent(result.eventId)}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Ersteinrichtung fehlgeschlagen.");
      setBusy(false);
    }
  }

  const setupAvailable = status?.setupRequired === true && status.setupConfigured;
  return (
    <Shell className="setup-shell" title="Ersteinrichtung">
      <section className="setup-page">
        <span className="eyebrow">Einmaliger Systemstart</span>
        <h1>Rundflug-Leitstand einrichten</h1>
        {status && !status.setupRequired ? (
          <>
            <p>Die Ersteinrichtung ist bereits abgeschlossen.</p>
            <a className="privacy-link" href="/admin">
              Zur Administration
            </a>
          </>
        ) : (
          <>
            <p>
              Legt die erste Veranstaltung und das erste anonyme Administrationskonto an. Es werden
              keine Personen- oder Gastnamen erfasst.
            </p>
            {status && !status.setupConfigured ? (
              <p className="connection-warning">Der Installations-Notfallcode fehlt noch.</p>
            ) : null}
            {status?.resetSetupAuthorized ? (
              <p className="connection-success">
                Dieser Browser darf die Einrichtung nach dem Werksreset direkt fortsetzen
                {status.resetSetupExpiresAt
                  ? ` – gültig bis ${new Date(status.resetSetupExpiresAt).toLocaleTimeString(
                      "de-DE",
                      { hour: "2-digit", minute: "2-digit" },
                    )} Uhr.`
                  : "."}
              </p>
            ) : null}
            <div className="setup-grid">
              <label>
                Technische Veranstaltungs-ID{" "}
                <input
                  value={eventId}
                  onChange={(event) => setEventId(event.target.value.toLowerCase())}
                  aria-describedby="event-id-help"
                />
                <small id="event-id-help">Kleinbuchstaben, Ziffern und Bindestriche</small>
              </label>
              <label>
                Bezeichnung <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <LocalizedDateInput label="Datum" value={eventDate} onChange={setEventDate} />
              <label>
                Flugplatz{" "}
                <input
                  value={aerodrome}
                  onChange={(event) => setAerodrome(event.target.value)}
                  placeholder="z. B. EDXX"
                />
              </label>
              {!status?.resetSetupAuthorized ? (
                <label>
                  Installations-Notfallcode{" "}
                  <input
                    type="password"
                    value={setupCode}
                    onChange={(event) => setSetupCode(event.target.value)}
                    autoComplete="off"
                  />
                  <small>Aus dem betreiberseitigen Passwortsafe</small>
                </label>
              ) : null}
              <label>
                Erste Administrator-PIN{" "}
                <input
                  type="password"
                  inputMode="numeric"
                  value={adminPin}
                  onChange={(event) => setAdminPin(event.target.value.replace(/\D/g, ""))}
                  minLength={6}
                  maxLength={12}
                  autoComplete="off"
                />
                <small>6–12 Ziffern; danach Anmeldung als ADMIN-01</small>
              </label>
            </div>
            <Button
              busy={busy}
              className="primary-action"
              type="button"
              disabled={!setupAvailable}
              onClick={() => void submitSetup()}
              variant="primary"
            >
              System einmalig einrichten
            </Button>
          </>
        )}
      </section>
    </Shell>
  );
}
