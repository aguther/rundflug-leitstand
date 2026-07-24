import { describe, expect, it } from "vitest";
import { isIosDevice, isStandaloneDisplay } from "./use-public-push";

describe("iPhone-Web-Push-Umgebung", () => {
  it("erkennt iPhone und iPadOS im Desktop-User-Agent", () => {
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isIosDevice({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("unterscheidet Browser- und Home-Screen-Modus", () => {
    expect(isStandaloneDisplay({ navigatorStandalone: false, displayModeStandalone: false })).toBe(
      false,
    );
    expect(isStandaloneDisplay({ navigatorStandalone: true, displayModeStandalone: false })).toBe(
      true,
    );
    expect(isStandaloneDisplay({ navigatorStandalone: false, displayModeStandalone: true })).toBe(
      true,
    );
  });
});
