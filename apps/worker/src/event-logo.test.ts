import { describe, expect, it } from "vitest";
import {
  MAX_EVENT_LOGO_BYTES,
  parseEventLogoTheme,
  readEventLogoBytes,
  validateEventLogo,
} from "./event-logo";

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

  it("normalizes the optional theme while rejecting unknown variants", () => {
    expect(parseEventLogoTheme(null)).toBe("light");
    expect(parseEventLogoTheme("LIGHT")).toBe("light");
    expect(parseEventLogoTheme("dark")).toBe("dark");
    expect(parseEventLogoTheme("contrast")).toBeNull();
  });

  it("streams bounded request bodies and rejects uploads beyond one MiB", async () => {
    const safeBytes = new TextEncoder().encode("<svg></svg>");
    const safeRequest = new Request("https://example.test/logo", {
      method: "PUT",
      body: safeBytes,
    });
    await expect(readEventLogoBytes(safeRequest)).resolves.toEqual(safeBytes);

    const oversizedRequest = new Request("https://example.test/logo", {
      method: "PUT",
      body: new Uint8Array(MAX_EVENT_LOGO_BYTES + 1),
    });
    await expect(readEventLogoBytes(oversizedRequest)).rejects.toThrow("EVENT_LOGO_SIZE_INVALID");
  });
});
