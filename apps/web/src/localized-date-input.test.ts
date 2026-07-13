import { describe, expect, it } from "vitest";
import {
  format24HourTyping,
  formatGermanDate,
  formatGermanDateTyping,
  parseGermanDate,
  replaceLocalDate,
  replaceLocalTime,
} from "./localized-date-input";

describe("localized date and time inputs", () => {
  it("keeps the 24-hour time when the German date changes", () => {
    expect(replaceLocalDate("2026-07-13T17:45", "2026-07-14")).toBe("2026-07-14T17:45");
  });

  it("starts a newly selected date at midnight", () => {
    expect(replaceLocalDate("", "2026-07-14")).toBe("2026-07-14T00:00");
  });

  it("updates the time without changing the date", () => {
    expect(replaceLocalTime("2026-07-14T00:00", "23:15")).toBe("2026-07-14T23:15");
  });

  it("formats and parses German calendar dates", () => {
    expect(formatGermanDate("2026-07-14")).toBe("14.07.2026");
    expect(parseGermanDate("14.07.2026")).toBe("2026-07-14");
    expect(parseGermanDate("31.02.2026")).toBeNull();
  });

  it("normalizes typed dates and 24-hour times", () => {
    expect(formatGermanDateTyping("14072026")).toBe("14.07.2026");
    expect(format24HourTyping("2315")).toBe("23:15");
  });
});
