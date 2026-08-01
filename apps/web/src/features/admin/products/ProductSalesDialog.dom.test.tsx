// @vitest-environment jsdom
import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductSalesDialog } from "./ProductSalesDialog";
import { ProductsWorkspace } from "./ProductsWorkspace";

const product = {
  id: "product-a",
  code: "RN",
  name: "Rundflug",
  publicDescription: "Synthetisches Produkt",
  resourceGroupName: "Normal",
  gateLabel: "Halle",
  priceCents: 4_000,
  promisedFlightMinutes: 15,
  referenceDurationMinutes: 15,
  effectiveTurnaroundProfile: { totalGroundMinutes: 16 },
  saleEnabled: true,
  saleClosesAt: null,
  remainingSellableSeats: 12,
  capacityStatus: "AVAILABLE",
  saleRecommended: true,
  predictionQuality: "STABLE",
} as OperationBoard["products"][number];

afterEach(cleanup);

describe("product sales administration", () => {
  it("opens sales control from the accessible Handbag row action", () => {
    const onSales = vi.fn();
    render(
      <ProductsWorkspace
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onSales={onSales}
        onSort={vi.fn()}
        onTurnaround={vi.fn()}
        rows={[product]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Verkauf für Rundflug steuern" }));
    expect(onSales).toHaveBeenCalledWith("product-a");
  });

  it("allows closing-time changes but not live switching during preparation", () => {
    render(
      <ProductSalesDialog
        busyAction={null}
        closingValue=""
        eventStatus="PREPARATION"
        onClose={vi.fn()}
        onClosingChange={vi.fn()}
        onSaveClosing={vi.fn()}
        onToggleSales={vi.fn()}
        product={product}
      />,
    );

    expect(screen.getByText("Ab Betriebsfreigabe verfügbar")).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "Verkauf sperren" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("12")).not.toBeNull();
    expect(screen.getByText("Kapazität verfügbar")).not.toBeNull();
  });

  it("protects an unsaved closing time and disables the separate live switch", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ProductSalesDialog
        busyAction={null}
        closingValue=""
        eventStatus="ACTIVE"
        onClose={onClose}
        onClosingChange={vi.fn()}
        onSaveClosing={vi.fn()}
        onToggleSales={vi.fn()}
        product={product}
      />,
    );
    rerender(
      <ProductSalesDialog
        busyAction={null}
        closingValue="2026-07-31T18:00"
        eventStatus="ACTIVE"
        onClose={onClose}
        onClosingChange={vi.fn()}
        onSaveClosing={vi.fn()}
        onToggleSales={vi.fn()}
        product={product}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Verkauf sperren" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(screen.getByRole("alertdialog", { name: "Verkaufsschluss verwerfen?" })).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders sales controls read-only after operations end", () => {
    render(
      <ProductSalesDialog
        busyAction={null}
        closingValue=""
        eventStatus="CLOSED"
        onClose={vi.fn()}
        onClosingChange={vi.fn()}
        onSaveClosing={vi.fn()}
        onToggleSales={vi.fn()}
        product={product}
      />,
    );

    expect(screen.getByText("Nach Betriebsende nur lesend")).not.toBeNull();
    expect(
      (screen.getByRole("button", { name: "Verkauf sperren" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Verkaufsschluss speichern" })).toBeNull();
  });
});
