import { describe, expect, it } from "vitest";
import { setupValidationMessages } from "./setup-validation";

const validSetup = {
  eventId: "rundflug-2026",
  name: "Rundflug 2026",
  eventDate: "2026-07-13",
  aerodrome: "EDXX",
  setupCode: "synthetic-code-16",
  adminPin: "0000",
};

describe("setupValidationMessages", () => {
  it("akzeptiert einen vollständigen anonymen Setup-Datensatz", () => {
    expect(setupValidationMessages(validSetup)).toEqual([]);
  });

  it("nennt jede Ursache für einen zuvor nur gesperrten Setup-Button", () => {
    expect(
      setupValidationMessages({
        eventId: "Rundflug 2026",
        name: "x",
        eventDate: "",
        aerodrome: "",
        setupCode: "zu-kurz",
        adminPin: "123",
      }),
    ).toEqual([
      "Die technische Veranstaltungs-ID benötigt 3–64 Kleinbuchstaben, Ziffern oder Bindestriche.",
      "Die Bezeichnung benötigt 3–120 Zeichen.",
      "Bitte ein Veranstaltungsdatum auswählen.",
      "Der Flugplatz benötigt 2–120 Zeichen.",
      "Der einmalige Einrichtungscode benötigt 16–256 Zeichen.",
      "Die Administrator-PIN benötigt 4–32 Zeichen.",
    ]);
  });
});
