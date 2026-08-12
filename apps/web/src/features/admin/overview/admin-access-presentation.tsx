import { ValidationHint } from "../../../admin-ux";

interface BoardStatusHintProps {
  administrator: boolean;
  boardLoadFailed: boolean;
}

export function accessPresentation(authenticated: boolean, unlocked: boolean) {
  if (authenticated) {
    return {
      title: "Administration aktiv",
      descriptionSuffix: " · Änderungen werden dem angemeldeten Konto zugeordnet.",
      actionLabel: "Abmelden",
      hint: "Die Anmeldung ersetzt wiederholte PIN-Abfragen. Jede Änderung bleibt einzeln protokolliert.",
    };
  }
  if (unlocked) {
    return {
      title: "Bearbeitungsmodus aktiv",
      description:
        "Mehrere Änderungen sind möglich. Jede Änderung wird weiterhin einzeln protokolliert.",
      actionLabel: "Bearbeitungsmodus sperren",
      hint: "Änderungen sind freigeschaltet und werden automatisch protokolliert.",
    };
  }
  return {
    title: "Administration gesperrt",
    description:
      "Änderungen fragen die PIN einzeln ab oder können für diese Arbeitssitzung entsperrt werden.",
    actionLabel: "Bearbeitungsmodus entsperren",
    hint: "Beim Auslösen einer administrativen Änderung erscheint die PIN-Abfrage.",
  };
}

export function BoardStatusHint({
  administrator,
  boardLoadFailed,
}: Readonly<BoardStatusHintProps>) {
  if (administrator) {
    return null;
  }
  if (boardLoadFailed) {
    return (
      <ValidationHint tone="error">
        Der Betriebsstand konnte nicht geladen werden. Erneut laden oder mit einem
        Administrationskonto anmelden; vorhandene Betriebsdaten bleiben unverändert.
      </ValidationHint>
    );
  }
  return <ValidationHint>Sitzung und Betriebsstand werden geprüft.</ValidationHint>;
}
