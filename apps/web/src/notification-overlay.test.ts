import { describe, expect, it } from "vitest";
import { inferActionNoticeTone } from "./app/PageNotifications";

describe("cross-surface page notifications", () => {
  it("classifies successful operator feedback", () => {
    expect(inferActionNoticeTone("Belegung bestätigt.")).toBe("success");
  });

  it("classifies failed operator feedback", () => {
    expect(inferActionNoticeTone("Aktion fehlgeschlagen.")).toBe("danger");
  });
});
