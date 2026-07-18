import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import adminUxSource from "./admin-ux.tsx?raw";
import adminViewSource from "./admin-view.tsx?raw";

const adminStyles = readFileSync(
  new URL("./features/admin/admin-v15.css", import.meta.url),
  "utf8",
);

describe("V1.5 administration UI", () => {
  it("uses one compact setup flow and the shared design-system primitives", () => {
    expect(adminViewSource.match(/<SetupProgress/g)).toHaveLength(1);
    expect(adminViewSource).toContain('className="event-setup-v15"');
    expect(adminViewSource).toContain('className="event-release-v15"');
    expect(adminViewSource).toContain('className="event-catalog-v15"');
    expect(adminViewSource).toContain("<PageHeader");
    expect(adminViewSource).toContain("<Panel");
    expect(adminViewSource).toContain("<TextField");
    expect(adminViewSource).toContain("<Button");
  });

  it("keeps reset actions out of the event setup workspace", () => {
    const setupWorkspace = adminViewSource.slice(
      adminViewSource.indexOf('<div className="event-setup-v15"'),
      adminViewSource.indexOf('<Panel className="event-catalog-v15"'),
    );
    expect(setupWorkspace).not.toContain("Betriebsdaten zurücksetzen");
    expect(setupWorkspace).not.toContain("Werkszustand");
  });

  it("supports SVG branding and consistent Pilotencode terminology", () => {
    expect(adminViewSource).toContain("image/svg+xml");
    expect(adminViewSource).toContain("PNG, JPEG, WebP oder sicheres SVG bis 1 MiB.");
    expect(adminUxSource).toContain('{ id: "pilots", label: "Pilotencodes" }');
  });

  it("defines stable compact and phone layouts without page-level horizontal overflow", () => {
    expect(adminStyles).toContain("grid-template-columns: repeat(6, minmax(110px, 1fr))");
    expect(adminStyles).toContain("grid-template-columns: minmax(150px, 1fr) auto 112px");
    expect(adminStyles).toContain("overflow-x: auto");
    expect(adminStyles).toContain("scrollbar-width: none");
    expect(adminStyles).toContain("flex-direction: column");
  });
});
