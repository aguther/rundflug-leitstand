import { describe, expect, it } from "vitest";
import { PUBLIC_STATUS_PRESENTATIONS, publicStatusMessage } from "./public-status-model";

describe("öffentliche FIDS-Statusabbildung", () => {
  it.each([
    ["WAITING", "WARTEN", "Clock3", "Bitte Status regelmäßig prüfen."],
    ["PREPARE", "WARTEN", "Clock3", "Ihr Aufruf steht bevor. Bitte bereithalten."],
    ["COME_TO_FLIGHT_LINE", "GO TO GATE", "CircleArrowRight", "Bitte jetzt zum Gate kommen."],
    ["BOARDING", "BOARDING", "TicketsPlane", "Bitte am Gate zum Einstieg bereithalten."],
    ["IN_FLIGHT", "OFF-BLOCK", "PlaneTakeoff", "Ihr Rundflug ist gestartet."],
    ["LANDED", "ON-BLOCK", "PlaneLanding", "Ihr Rundflug ist gelandet."],
    ["COMPLETED", "ABGESCHLOSSEN", "CircleCheck", "Ihr Rundflug ist abgeschlossen."],
  ] as const)("bildet %s auf %s mit Symbol und exaktem Text ab", (status, label, icon, message) => {
    expect(PUBLIC_STATUS_PRESENTATIONS[status]).toMatchObject({
      label,
      iconName: icon,
      defaultMessage: message,
    });
    expect(publicStatusMessage(status, "abweichender Servertext")).toBe(message);
  });

  it("zeigt den konkreten Unterbrechungsgrund bei VERZÖGERT", () => {
    expect(PUBLIC_STATUS_PRESENTATIONS.SERVICE_PAUSED).toMatchObject({
      label: "VERZÖGERT",
      iconName: "Clock3",
      defaultMessage: null,
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
