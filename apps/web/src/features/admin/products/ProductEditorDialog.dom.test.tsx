// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductEditorDialog } from "./ProductEditorDialog";
import { useProductEditorState } from "./useProductEditorState";

const board = {
  event: {
    plannedBoardingMinutes: 8,
    plannedDeboardingMinutes: 5,
    plannedBufferMinutes: 3,
  },
  gates: [
    { id: "gate-a", label: "Gate A", active: true },
    { id: "gate-b", label: "Gate B", active: false },
  ],
  resourceGroups: [{ id: "group-a", name: "Panorama queue" }],
  products: [
    {
      id: "product-a",
      name: "Panorama flight",
      code: "PAN20",
      publicDescription: "Scenic flight",
      resourceGroupId: "group-a",
      gateId: "gate-a",
      priceCents: 4200,
      referenceDurationMinutes: 20,
      promisedFlightMinutes: 18,
      plannedBoardingMinutesOverride: null,
      plannedDeboardingMinutesOverride: null,
      plannedBufferMinutesOverride: null,
      childCompanionRequired: false,
      weightClasses: ["NOT_CAPTURED"],
    },
  ],
} as unknown as OperationBoard;

interface HarnessProps {
  initialTab?: "general" | "details";
  selectedId?: string;
  submitAttempted?: boolean;
}

function Harness({ initialTab = "general", selectedId, submitAttempted = false }: HarnessProps) {
  const editor = useProductEditorState(board);
  const [tab, setTab] = useState<"general" | "details">(initialTab);
  useEffect(() => {
    if (selectedId) editor.select(selectedId);
  }, [editor.select, selectedId]);

  return (
    <ProductEditorDialog
      board={board}
      editor={editor}
      footer={<button type="button">Speichern</button>}
      furtherActions={<button type="button">Weitere Aktionen</button>}
      initialFocusSelector="#product-name"
      onClose={() => undefined}
      onTabChange={setTab}
      open
      resourceGroups={board.resourceGroups}
      submitAttempted={submitAttempted}
      tab={tab}
    />
  );
}

afterEach(cleanup);

describe("product editor dialog", () => {
  it("presents the general product fields in a wide dialog", () => {
    render(<Harness />);

    const dialog = screen.getByRole("dialog", { name: "Produkt anlegen" });
    expect(dialog.classList.contains("ds-modal-dialog--wide")).toBe(true);
    expect(screen.getByLabelText("Bezeichnung")).toBeTruthy();
    expect((screen.getByLabelText("Preis in €") as HTMLInputElement).value).toBe("0,00 €");
    expect(screen.queryByLabelText("Gewichtserfassung")).toBeNull();
    expect(screen.queryByText("Bei Kinderbuchungen auf Begleitung hinweisen")).toBeNull();
  });

  it("normalizes the informational ticket price on blur", () => {
    render(<Harness />);
    const price = screen.getByLabelText("Preis in €") as HTMLInputElement;

    fireEvent.change(price, { target: { value: "12,5" } });
    fireEvent.blur(price);

    expect(price.value).toBe("12,50 €");
  });

  it("keeps communicated and operational timing inputs separate", () => {
    render(<Harness initialTab="details" />);

    expect(screen.getByRole("option", { name: "Panorama queue" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Gate A" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Gate B" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /beeinflusst die operative Prognose nicht/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /Operative Planzeit vom bestätigten Offblock bis zum bestätigten Onblock.*weder die vollständige Umlaufzeit noch ausschließlich die beworbene Flugzeit/,
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Referenzzeit Offblock–Onblock (Min.)")).toBeTruthy();
    expect(screen.getByLabelText("Kommunizierte Flugzeit (Min.)")).toBeTruthy();
    expect(screen.queryByLabelText("Plan-Umlaufzeit")).toBeNull();
  });

  it("switches a timing source between event and product values", () => {
    render(<Harness initialTab="details" />);
    const boarding = screen.getByLabelText("Boarding (Min.)") as HTMLInputElement;
    const setOverride = screen.getAllByRole("button", {
      name: "Produktabweichung festlegen",
    })[0];
    if (!setOverride) throw new Error("Expected a boarding override action.");

    fireEvent.click(setOverride);
    expect(boarding.value).toBe("8");
    expect(screen.getAllByText("Quelle: Produkt").length).toBeGreaterThan(0);

    const removeOverride = screen.getAllByRole("button", {
      name: "Produktabweichung entfernen",
    })[0];
    if (!removeOverride) throw new Error("Expected a boarding override removal action.");
    fireEvent.click(removeOverride);
    expect(boarding.value).toBe("");
  });

  it("loads an existing product without changing its source projection", async () => {
    render(<Harness selectedId="product-a" />);

    await screen.findByRole("dialog", { name: "Produkt bearbeiten" });
    expect((screen.getByLabelText("Bezeichnung") as HTMLInputElement).value).toBe(
      "Panorama flight",
    );
    expect(board.products[0]?.name).toBe("Panorama flight");
  });

  it("keeps required-field guidance inside the extracted dialog", () => {
    render(<Harness submitAttempted />);

    expect(screen.getByText("Mindestens 2 Zeichen eingeben.")).toBeTruthy();
    expect(screen.getByText("Zum Beispiel PAN20 oder KURZ-10.")).toBeTruthy();
  });
});
