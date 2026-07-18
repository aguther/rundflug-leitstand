import { AppShell as Shell } from "./app/AppShell";
import { rememberDeviceCredential } from "./device-credentials";
import { rememberDisplayBinding } from "./display-context";
import { rememberActiveEvent } from "./event-context";

export function PairDeviceView() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const deviceId = params.get("device") ?? "";
  const token = params.get("token") ?? "";
  const role = params.get("role") ?? "";
  const eventId = params.get("event") ?? "";
  const gateId = params.get("gate")?.trim() || null;
  const displayMode = params.get("style") === "terminal" ? "terminal" : "standard";
  const roleTargets: Record<string, string> = {
    CASHIER: "/",
    FLIGHT_LINE: "/flight-line",
    FLIGHT_LINE_LEAD: "/flight-line",
    FLIGHT_DIRECTOR: "/admin",
    ADMIN: "/admin",
    DISPLAY: "/fids?kiosk=1",
  };
  const valid =
    /^[0-9a-f-]{36}$/i.test(deviceId) &&
    /^[A-Za-z0-9_-]{40,64}$/.test(token) &&
    eventId.trim().length > 0 &&
    role in roleTargets;
  const activate = () => {
    if (!valid) return;
    const viewRole =
      role === "FLIGHT_LINE_LEAD" ? "FLIGHT_LINE" : role === "FLIGHT_DIRECTOR" ? "ADMIN" : role;
    rememberDeviceCredential(window.localStorage, viewRole, deviceId, token);
    rememberActiveEvent(window.localStorage, eventId);
    if (role === "DISPLAY") {
      rememberDisplayBinding(window.localStorage, {
        eventId,
        gateId,
        mode: displayMode,
      });
    }
    window.history.replaceState(null, "", "/pair");
    const target =
      role === "DISPLAY" && displayMode === "terminal"
        ? "/fids/terminal?kiosk=1"
        : (roleTargets[role] ?? "/");
    window.location.assign(target);
  };
  return (
    <Shell title="Gerätekopplung">
      <section className="pair-device-page">
        <span className="eyebrow">Anonyme Geräteidentität</span>
        <h1>Gerät koppeln</h1>
        {valid ? (
          <>
            <p>
              Dieses Gerät erhält für den Veranstaltungstag die feste Rolle <strong>{role}</strong>.
              {role === "DISPLAY" ? (
                <> Anzeigeprofil und Gate-Filter werden mit dieser Kopplung dauerhaft übernommen.</>
              ) : null}{" "}
              Es wird kein persönliches Helferkonto angelegt.
            </p>
            <button className="primary-action" onClick={activate} type="button">
              Kopplung bestätigen
            </button>
          </>
        ) : (
          <p>
            Der Kopplungslink ist ungültig. Bitte in der Administration einen neuen QR-Code
            erzeugen.
          </p>
        )}
      </section>
    </Shell>
  );
}
