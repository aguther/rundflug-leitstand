import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE_PAUSED_MESSAGE,
  PUBLIC_STATUS_MESSAGES,
  publicServicePausedMessage,
} from "./public-status-copy";

describe("öffentliche Ticket- und Gruppen-Copy", () => {
  it("hält die freigegebenen Beschreibungen als kanonischen Worker-Katalog", () => {
    expect(PUBLIC_STATUS_MESSAGES).toEqual({
      WAITING: "Sie befinden sich in der Warteschlange. Bitte prüfen Sie den Status regelmäßig.",
      PREPARE: "Ihr Aufruf steht bevor. Bitte halten Sie sich in der Nähe des Gates bereit.",
      COME_TO_FLIGHT_LINE:
        "Bitte kommen Sie jetzt zum Gate und warten Sie dort auf den Boardingaufruf.",
      BOARDING: "Das Boarding hat begonnen. Bitte halten Sie Ihr Ticket für den Einstieg bereit.",
      IN_FLIGHT: "Ihr Rundflug ist gestartet.",
      LANDED: "Ihr Rundflug ist gelandet.",
      COMPLETED: "Ihr Rundflug ist abgeschlossen. Vielen Dank fürs Mitfliegen!",
    });
    expect(DEFAULT_SERVICE_PAUSED_MESSAGE).toBe(
      "Der Flugbetrieb ist derzeit verzögert. Bitte prüfen Sie den Status später erneut.",
    );
  });

  it("priorisiert konkrete Betriebsgründe und behält einen neutralen Rückfall", () => {
    expect(
      publicServicePausedMessage({
        emergencyMode: true,
        resourceGroupActive: false,
        operationalInterrupted: true,
      }),
    ).toBe("Organisatorischer Betrieb pausiert – bitte später erneut prüfen.");
    expect(
      publicServicePausedMessage({
        emergencyMode: false,
        resourceGroupActive: false,
        operationalInterrupted: true,
      }),
    ).toBe("Flugbetrieb für dieses Produkt pausiert – bitte Status erneut prüfen.");
    expect(
      publicServicePausedMessage({
        emergencyMode: false,
        resourceGroupActive: true,
        operationalInterrupted: true,
      }),
    ).toBe("Flugbetrieb unterbrochen – bitte Status erneut prüfen.");
    expect(
      publicServicePausedMessage({
        emergencyMode: false,
        resourceGroupActive: true,
        operationalInterrupted: false,
      }),
    ).toBe(DEFAULT_SERVICE_PAUSED_MESSAGE);
  });
});
