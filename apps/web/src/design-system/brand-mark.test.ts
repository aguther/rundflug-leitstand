import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLockup, BrandSymbol } from "./BrandMark";
import source from "./BrandMark.tsx?raw";

const baseStyles = readFileSync(new URL("./base.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
const publicStyles = readFileSync(
  new URL("../features/public-status/public-status-v18.css", import.meta.url),
  "utf8",
);

describe("Rundflug-Leitstand branding fallback", () => {
  it("renders the supplied route-and-aircraft geometry without the legacy Plane icon", () => {
    const markup = renderToStaticMarkup(createElement(BrandSymbol));
    expect(markup).toContain('viewBox="0 0 48 48"');
    expect(markup).toContain("M32.54 4.82A21 21 0 1 0 43.18 15.46");
    expect(markup).toContain('aria-hidden="true"');
    expect(source).not.toContain('from "lucide-react"');
    expect(source).toContain("fallback-mark");
  });

  it("exposes one accessible product name and keeps visible word lines decorative", () => {
    const markup = renderToStaticMarkup(createElement(BrandLockup));
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Rundflug Leitstand"');
    expect(markup).toContain(">Rundflug<");
    expect(markup).toContain(">Leitstand<");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("uses local font assets and theme-safe ink and amber tokens", () => {
    expect(mainSource).toContain("@fontsource/barlow-condensed/latin-200.css");
    expect(mainSource).toContain("@fontsource/barlow-condensed/latin-400.css");
    expect(tokens).toContain("--brand-ink: #0d1b26");
    expect(tokens).toContain("--brand-ink: #e6edf3");
    expect(tokens).toContain("--brand-accent: #ffb020");
    expect(baseStyles).toContain('font-family: "Barlow Condensed"');
    expect(baseStyles).toContain("letter-spacing: 0.054em");
    expect(publicStyles).toMatch(
      /\.app-header--public \.fallback-mark[\s\S]*color: var\(--brand-ink\)/,
    );
  });

  it("requests the resolved logo theme and falls back only after that URL fails", () => {
    expect(source).toContain("const theme = explicitTheme ?? resolved");
    expect(source).toMatch(/logo\?theme=\$\{theme\}\$\{revisionQuery\}/);
    expect(source).toContain("unavailableLogoUrl !== logoUrl");
  });
});
