import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gradientPattern = /(?:linear|radial)-gradient\(/;

const quietSurfaceStylesheets = [
  "./admin/admin-v12.css",
  "./cashier/cashier-v12.css",
  "./flight-line/flight-line-v12.css",
  "./fids/fids-v12.css",
];

describe("quiet surfaces stay gradient-free", () => {
  it.each(
    quietSurfaceStylesheets,
  )("%s has no gradients (Admin/Kasse/Supervisor/FIDS are calm, table-dense surfaces per the multi-surface concept)", (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    expect(source).not.toMatch(gradientPattern);
  });

  it("the shared design-system component library has no gradients either", () => {
    const source = readFileSync(
      new URL("../design-system/components.css", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(gradientPattern);
  });
});
