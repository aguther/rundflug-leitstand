import { describe, expect, it } from "vitest";
import { createCsv, createTextPdf } from "./report";

describe("report formats", () => {
  it("escapes semicolon-separated CSV cells", () => {
    expect(createCsv([["A;B", 2, null]])).toBe('\uFEFF"A;B";2;\r\n');
  });

  it("creates a structurally complete PDF", () => {
    const text = new TextDecoder().decode(createTextPdf("Tagesbericht", ["Fluege: 3"]));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("(Tagesbericht) Tj");
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });
});
