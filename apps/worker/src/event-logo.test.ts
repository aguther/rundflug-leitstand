import { describe, expect, it } from "vitest";
import { validateEventLogo } from "./event-logo";

describe("event logo validation", () => {
  it("accepts SVG and raster formats by content instead of filename", () => {
    expect(
      validateEventLogo(
        new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        "image/svg+xml",
      ),
    ).toBe("image/svg+xml");
    expect(
      validateEventLogo(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/png",
      ),
    ).toBe("image/png");
  });

  it("rejects active SVG content and mismatched media types", () => {
    expect(() =>
      validateEventLogo(new TextEncoder().encode("<svg onload='alert(1)'></svg>"), "image/svg+xml"),
    ).toThrow("EVENT_LOGO_SVG_UNSAFE");
    expect(() => validateEventLogo(new TextEncoder().encode("<svg></svg>"), "image/png")).toThrow(
      "EVENT_LOGO_MEDIA_TYPE_INVALID",
    );
  });
});
