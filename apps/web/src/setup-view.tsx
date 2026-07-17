import { useEffect, useState } from "react";
import { bootstrapSystem, getSetupStatus } from "./api";
import { AppShell as Shell } from "./app/AppShell";
import { rememberDeviceCredential } from "./device-credentials";
import { rememberActiveEvent } from "./event-context";
import { eventDateInTimeZone } from "./event-time";
import { LocalizedDateInput } from "./localized-date-input";
import { createDeviceToken, sha256HexBrowser } from "./operation-workspace";
import { setupValidationMessages } from "./setup-validation";

export function SetupView() {
  const [status, setStatus] = useState<{
    setupRequired: boolean;
    setupConfigured: boolean;
  } | null>(null);
  const [eventId, setEventId] = useState(`rundflug-${new Date().getFullYear()}`);
  const [name, setName] = useState(`Rundflug ${new Date().getFullYear()}`);
  const [eventDate, setEventDate] = useState(eventDateInTimeZone(new Date(), "Europe/Berlin"));
  const [aerodrome, setAerodrome] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
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
    const validationMessages = setupValidationMessages({
      eventId,
      name,
      eventDate,
      aerodrome,
      setupCode,
      adminPin,
    });
    if (validationMessages.length > 0) {
      setMessage(validationMessages.join(" "));
      return;
    }
    setBusy(true);
    try {
      const adminDeviceId = crypto.randomUUID();
      const token = createDeviceToken();
      const result = await bootstrapSystem({
        setupCode,
        adminPin,
        eventId: eventId.trim(),
        name: name.trim(),
        eventDate,
        aerodrome: aerodrome.trim(),
        timeZone: "Europe/Berlin",
        adminDeviceId,
        adminCredentialHash: await sha256HexBrowser(token),
      });
      rememberDeviceCredential(window.localStorage, "ADMIN", result.adminDeviceId, token);
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
              Legt die erste Veranstaltung und dieses anonyme Administrationsgerät an. Es werden
              keine Personen- oder Gastnamen erfasst.
            </p>
            {status && !status.setupConfigured ? (
              <p className="connection-warning">
                Der einmalige Cloudflare-Einrichtungscode fehlt noch.
              </p>
            ) : null}
            <div className="setup-grid">
              <label>
                Technische Veranstaltungs-ID
                <input
                  value={eventId}
                  onChange={(event) => setEventId(event.target.value.toLowerCase())}
                  aria-describedby="event-id-help"
                />
                <small id="event-id-help">Kleinbuchstaben, Ziffern und Bindestriche</small>
              </label>
              <label>
                Bezeichnung
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <LocalizedDateInput label="Datum" value={eventDate} onChange={setEventDate} />
              <label>
                Flugplatz
                <input
                  value={aerodrome}
                  onChange={(event) => setAerodrome(event.target.value)}
                  placeholder="z. B. EDXX"
                />
              </label>
              <label>
                Einmaliger Einrichtungscode
                <input
                  type="password"
                  value={setupCode}
                  onChange={(event) => setSetupCode(event.target.value)}
                  autoComplete="off"
                />
                <small>Mindestens 8 Zeichen; exakt wie im Terminal eingegeben</small>
              </label>
              <label>
                Erste Administrator-PIN
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
            <button
              className="primary-action"
              type="button"
              disabled={!setupAvailable || busy}
              onClick={() => void submitSetup()}
            >
              {busy ? "Einrichtung läuft …" : "System einmalig einrichten"}
            </button>
          </>
        )}
        {message ? (
          <p className="action-message" role="status">
            {message}
          </p>
        ) : null}
      </section>
    </Shell>
  );
}
