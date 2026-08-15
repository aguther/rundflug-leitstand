import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLockup, BrandSymbol } from "./BrandMark";

describe("Rundflug-Leitstand branding fallback", () => {
  it("renders the supplied route-and-aircraft geometry without the legacy Plane icon", () => {
    const markup = renderToStaticMarkup(createElement(BrandSymbol));
    expect(markup).toContain('viewBox="0 0 48 48"');
    expect(markup).toContain("M32.54 4.82A21 21 0 1 0 43.18 15.46");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("exposes one accessible product name and keeps visible word lines decorative", () => {
    const markup = renderToStaticMarkup(createElement(BrandLockup));
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Rundflug Leitstand"');
    expect(markup).toContain(">Rundflug<");
    expect(markup).toContain(">Leitstand<");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("labels standalone symbols through native SVG title semantics", () => {
    const markup = renderToStaticMarkup(createElement(BrandSymbol, { labelled: true }));
    expect(markup).toContain("<title>Rundflug Leitstand</title>");
    expect(markup).not.toContain('role="img"');
  });
});
