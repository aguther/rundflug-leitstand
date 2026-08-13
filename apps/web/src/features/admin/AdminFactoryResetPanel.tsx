import { ValidationHint } from "../../admin-ux";

interface AdminFactoryResetPanelProps {
  administrator: boolean;
  onOpen: () => void;
}

export function AdminFactoryResetPanel({
  administrator,
  onOpen,
}: Readonly<AdminFactoryResetPanelProps>) {
  return (
    <section className="reset-levels">
      {!administrator ? (
        <ValidationHint tone="error">
          Reset ist sichtbar, bleibt aber gesperrt, bis eine gültige Administrationssitzung
          bestätigt wurde.
        </ValidationHint>
      ) : null}
      <div className="reset-level-row factory-reset-row">
        <div>
          <h2>Werkszustand herstellen</h2>
          <p>
            Alle Anwendungsdaten, Stammdaten, Historien, Sitzungen und die Ersteinrichtung werden
            gelöscht. Danach startet das System wieder bei /setup.
          </p>
        </div>
        <button className="danger-action" disabled={!administrator} onClick={onOpen} type="button">
          <span>Werkszustand vorbereiten</span>
        </button>
      </div>
    </section>
  );
}
