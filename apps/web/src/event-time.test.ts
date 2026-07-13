import { describe, expect, it } from "vitest";
import {
  eventDateInTimeZone,
  eventLocalDateTimeToIso,
  formatEventLocalDateTime,
} from "./event-time";

describe("event time conversion", () => {
  it("formats stored UTC instants in the event timezone independent of the browser timezone", () => {
    expect(formatEventLocalDateTime("2026-07-11T12:00:00.000Z", "Europe/Berlin")).toBe(
      "2026-07-11T14:00",
    );
    expect(eventDateInTimeZone(new Date("2026-07-11T22:30:00.000Z"), "Europe/Berlin")).toBe(
      "2026-07-12",
    );
  });

  it("uses the correct Berlin offset in summer and winter", () => {
    expect(eventLocalDateTimeToIso("2026-07-11T14:00", "Europe/Berlin")).toBe(
      "2026-07-11T12:00:00.000Z",
    );
    expect(eventLocalDateTimeToIso("2026-01-11T14:00", "Europe/Berlin")).toBe(
      "2026-01-11T13:00:00.000Z",
    );
  });

  it("rejects a nonexistent local time during the spring DST transition", () => {
    expect(() => eventLocalDateTimeToIso("2026-03-29T02:30", "Europe/Berlin")).toThrow("existiert");
  });

  it("rejects an ambiguous local time during the autumn DST transition", () => {
    expect(() => eventLocalDateTimeToIso("2026-10-25T02:30", "Europe/Berlin")).toThrow(
      "mehrdeutig",
    );
  });

  it("rejects invalid IANA timezone identifiers", () => {
    expect(() => eventLocalDateTimeToIso("2026-07-11T14:00", "Mars/Olympus")).toThrow("ungültig");
  });
});
