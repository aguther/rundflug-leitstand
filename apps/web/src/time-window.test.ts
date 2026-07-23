import { describe, expect, it } from "vitest";
import { formatAbsoluteTimeWindow } from "./time-window";

describe("formatAbsoluteTimeWindow", () => {
  it("formatiert das reguläre und kompakte Veranstaltungszeitfenster exakt", () => {
    const window = {
      lowerAt: "2026-07-23T12:20:00.000Z",
      upperAt: "2026-07-23T12:40:00.000Z",
      timeZone: "Europe/Berlin",
      quality: "STABLE" as const,
    };
    expect(formatAbsoluteTimeWindow(window)).toBe("ca. 14:20 – 14:40 Uhr");
    expect(formatAbsoluteTimeWindow({ ...window, variant: "compact" })).toBe("14:20 – 14:40");
  });

  it("unterscheidet unmittelbaren Aufruf, Abschluss und unsichere Prognose", () => {
    const base = {
      lowerAt: null,
      upperAt: null,
      timeZone: "Europe/Berlin",
    };
    expect(formatAbsoluteTimeWindow({ ...base, phase: "NOW" })).toBe("Jetzt");
    expect(formatAbsoluteTimeWindow({ ...base, phase: "FINISHED" })).toBe("–");
    expect(formatAbsoluteTimeWindow({ ...base, quality: "UNCERTAIN" })).toBe("Wird aktualisiert");
    expect(
      formatAbsoluteTimeWindow({
        ...base,
        quality: "UNCERTAIN",
        variant: "compact",
      }),
    ).toBe("–");
  });

  it("zeigt bei einem Datumswechsel Datum und Uhrzeit", () => {
    const window = {
      lowerAt: "2026-07-23T21:50:00.000Z",
      upperAt: "2026-07-23T22:10:00.000Z",
      timeZone: "Europe/Berlin",
      quality: "CHANGING" as const,
    };
    expect(formatAbsoluteTimeWindow(window)).toBe("ca. 23.07.2026 23:50 – 24.07.2026 00:10 Uhr");
    expect(formatAbsoluteTimeWindow({ ...window, variant: "compact" })).toBe(
      "23.07.2026 23:50 – 24.07.2026 00:10",
    );
  });

  it("berücksichtigt die Sommerzeit der Veranstaltungszeitzone", () => {
    expect(
      formatAbsoluteTimeWindow({
        lowerAt: "2026-03-29T00:50:00.000Z",
        upperAt: "2026-03-29T01:10:00.000Z",
        timeZone: "Europe/Berlin",
        quality: "STABLE",
        variant: "compact",
      }),
    ).toBe("01:50 – 03:10");
  });
});
