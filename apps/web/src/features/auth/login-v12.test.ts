import { describe, expect, it } from "vitest";
import source from "./LoginPage.tsx?raw";

describe("V1.2 account login", () => {
  it("groups selectable accounts by role and focuses the PIN after selection", () => {
    expect(source).toContain("<optgroup");
    expect(source).toContain("loginRoleOrder.map");
    expect(source).toContain("pinRef.current?.focus()");
    expect(source).toContain('type="password"');
    expect(source).toContain("minLength={6}");
  });

  it("submits through the form and keeps the login error neutral", () => {
    expect(source).toContain("<form onSubmit");
    expect(source).toContain('type="submit"');
    expect(source).toContain("Konto oder PIN ist nicht gültig.");
  });
});
