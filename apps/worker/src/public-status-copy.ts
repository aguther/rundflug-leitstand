import type { PublicRotationStatus } from "@rundflug/domain";

export const PUBLIC_STATUS_MESSAGES = {
  WAITING: "Sie befinden sich in der Warteschlange. Bitte prüfen Sie den Status regelmäßig.",
  PREPARE: "Ihr Aufruf steht bevor. Bitte halten Sie sich in der Nähe des Gates bereit.",
  COME_TO_FLIGHT_LINE:
    "Bitte kommen Sie jetzt zum Gate und warten Sie dort auf den Boardingaufruf.",
  BOARDING: "Das Boarding hat begonnen. Bitte halten Sie Ihr Ticket für den Einstieg bereit.",
  IN_FLIGHT: "Ihr Rundflug ist gestartet.",
  LANDED: "Ihr Rundflug ist gelandet.",
  COMPLETED: "Ihr Rundflug ist abgeschlossen. Vielen Dank fürs Mitfliegen!",
} as const satisfies Record<PublicRotationStatus, string>;

export const DEFAULT_SERVICE_PAUSED_MESSAGE =
  "Der Flugbetrieb ist derzeit verzögert. Bitte prüfen Sie den Status später erneut.";

export function publicServicePausedMessage(input: {
  emergencyMode: boolean;
  resourceGroupActive: boolean;
  operationalInterrupted: boolean;
}): string {
  if (input.emergencyMode) {
    return "Organisatorischer Betrieb pausiert – bitte später erneut prüfen.";
  }
  if (!input.resourceGroupActive) {
    return "Flugbetrieb für dieses Produkt pausiert – bitte Status erneut prüfen.";
  }
  if (input.operationalInterrupted) {
    return "Flugbetrieb unterbrochen – bitte Status erneut prüfen.";
  }
  return DEFAULT_SERVICE_PAUSED_MESSAGE;
}
