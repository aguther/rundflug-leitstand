import { AccessPageFrame } from "./features/auth/AccessPageFrame";

export function PrivacyView() {
  return (
    <AccessPageFrame
      eyebrow="Datensparsame V1"
      title="Privatsphäre ohne Gastkonto"
      titleId="privacy-title"
      variant="reading"
    >
      <div className="access-page-reading-content ui-select-text">
        <p>
          Der Rundflug-Leitstand erfasst keine Namen und keine Telefonnummern. Der Ticketstatus ist
          ausschließlich über einen zufälligen Ticketcode erreichbar.
        </p>
        <h2>Web-Push ist freiwillig</h2>
        <p>
          Erst nach Ihrer aktiven Zustimmung speichert das System die pseudonyme Push-Adresse Ihres
          Browsers, die technischen Push-Schlüssel, den Einwilligungszeitpunkt und die Zuordnung zum
          Ticket. Die Daten dienen nur den Statushinweisen für dieses Ticket.
        </p>
        <p>
          Die Push-Daten werden bei Deaktivierung widerrufen und automatisch nach der für die
          Veranstaltung festgelegten Frist gelöscht, standardmäßig sieben Tage nach
          Veranstaltungsende. Der operative Ticket- und Auditbestand bleibt davon getrennt.
        </p>
        <a className="access-page-link" href="/">
          Zurück zum Leitstand
        </a>
      </div>
    </AccessPageFrame>
  );
}
