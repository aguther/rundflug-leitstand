import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appSource from "../../cashier-view.tsx?raw";

const stylesSource = readFileSync(new URL("./cashier-v12.css", import.meta.url), "utf8");

describe("V1.2 cashier", () => {
  it("uses the authenticated cashier session without another PIN prompt", () => {
    expect(appSource).toContain('className="cashier-shell"');
    expect(appSource).not.toContain("Administrator-PIN für Storno/Umbuchung");
    expect(appSource).toContain('adminPin: "SESSION"');
  });

  it("keeps product selection and sale controls compact", () => {
    expect(stylesSource).toContain("min-width: 210px");
    expect(stylesSource).toContain("grid-template-columns: 44px 90px 44px");
    expect(stylesSource).toContain("var(--ui-surface)");
  });

  it("keeps the confirmation action reachable on small devices", () => {
    expect(stylesSource).toContain("position: sticky");
    expect(stylesSource).toContain("bottom: 8px");
  });
});
