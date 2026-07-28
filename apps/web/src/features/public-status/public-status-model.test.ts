import { describe, expect, it } from "vitest";
import { PUBLIC_STATUS_PRESENTATIONS, publicStatusMessage } from "./public-status-model";

describe("öffentliche FIDS-Statusabbildung", () => {
  it.each([
    [
      "WAITING",
      "WARTEN",
      "Clock3",
      "Sie befinden sich in der Warteschlange. Bitte prüfen Sie den Status regelmäßig.",
    ],
    [
      "PREPARE",
      "BEREITHALTEN",
      "Clock3",
      "Ihr Aufruf steht bevor. Bitte halten Sie sich in der Nähe des Gates bereit.",
    ],
    [
      "COME_TO_FLIGHT_LINE",
      "BITTE ZUM GATE",
      "CircleArrowRight",
      "Bitte kommen Sie jetzt zum Gate und warten Sie dort auf den Boardingaufruf.",
    ],
    [
      "BOARDING",
      "BOARDING",
      "TicketsPlane",
      "Das Boarding hat begonnen. Bitte halten Sie Ihr Ticket für den Einstieg bereit.",
    ],
    ["IN_FLIGHT", "IM FLUG", "PlaneTakeoff", "Ihr Rundflug ist gestartet."],
    ["LANDED", "GELANDET", "PlaneLanding", "Ihr Rundflug ist gelandet."],
    [
      "COMPLETED",
      "ABGESCHLOSSEN",
      "CircleCheck",
      "Ihr Rundflug ist abgeschlossen. Vielen Dank fürs Mitfliegen!",
    ],
  ] as const)("bildet %s auf %s mit Symbol und exaktem Text ab", (status, label, icon, message) => {
    expect(PUBLIC_STATUS_PRESENTATIONS[status]).toMatchObject({
      label,
      iconName: icon,
    });
    expect(publicStatusMessage(status, message)).toBe(message);
  });

  it("zeigt den konkreten Unterbrechungsgrund bei VERZÖGERT", () => {
    expect(PUBLIC_STATUS_PRESENTATIONS.SERVICE_PAUSED).toMatchObject({
      label: "VERZÖGERT",
      iconName: "Clock3",
    });
    expect(
      publicStatusMessage(
        "SERVICE_PAUSED",
        "Flugbetrieb unterbrochen – bitte Status erneut prüfen.",
        "Wetterbedingte Unterbrechung.",
      ),
    ).toBe("Wetterbedingte Unterbrechung.");
  });
});
