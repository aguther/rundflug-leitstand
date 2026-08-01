import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createMasterEditorSnapshot, hasMasterEditorChanges } from "./admin-master-editor-state";
import { SetupProgress, type SetupStep } from "./admin-ux";

describe("master-data editor state", () => {
  it("detects scalar changes but ignores selection order", () => {
    const initial = createMasterEditorSnapshot([
      "gates",
      "Halle",
      true,
      10,
      ["product-b", "product-a"],
    ]);

    expect(
      hasMasterEditorChanges(
        initial,
        createMasterEditorSnapshot(["gates", "Halle", true, 10, ["product-a", "product-b"]]),
      ),
    ).toBe(false);
    expect(
      hasMasterEditorChanges(
        initial,
        createMasterEditorSnapshot(["gates", "Flight Line", true, 10, ["product-a", "product-b"]]),
      ),
    ).toBe(true);
    expect(
      hasMasterEditorChanges(
        initial,
        createMasterEditorSnapshot(["gates", "Halle", false, 10, ["product-a", "product-b"]]),
      ),
    ).toBe(true);
    expect(
      hasMasterEditorChanges(
        initial,
        createMasterEditorSnapshot(["gates", "Halle", true, 20, ["product-a", "product-b"]]),
      ),
    ).toBe(true);
    expect(hasMasterEditorChanges(null, initial)).toBe(false);
  });
});

describe("setup progress", () => {
  const steps: SetupStep[] = [
    { id: "event", label: "Veranstaltung", complete: true },
    { id: "gates", label: "Gates", complete: true },
    { id: "operations", label: "Betrieb", complete: false },
  ];

  it("marks a completed selected step as complete and current", () => {
    const markup = renderToStaticMarkup(
      createElement(SetupProgress, {
        currentStepId: "gates",
        onSelect: () => undefined,
        steps,
      }),
    );

    expect(markup).toContain('class="setup-progress-item complete current"');
    expect(markup.match(/aria-current="step"/g)).toHaveLength(1);
    expect(markup).toContain('class="setup-step-status"');
    expect(markup).toContain('class="setup-step-label">Gates</span>');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('class="setup-step-status"></span>');
    expect(markup).toContain('class="setup-progress-navigation"');
    expect(markup).toContain('aria-label="Vorherige Einrichtungsschritte anzeigen"');
    expect(markup).toContain('aria-label="Weitere Einrichtungsschritte anzeigen"');
  });
});
