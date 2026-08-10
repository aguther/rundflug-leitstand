// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminShellDialogs } from "./AdminShellDialogs";

vi.mock("./AdminAuthorizationDialog", () => ({ AdminAuthorizationDialog: () => null }));
vi.mock("./aircraft/AircraftProductTurnaroundOverrideDialog", () => ({
  AircraftProductTurnaroundOverrideDialog: () => null,
}));
vi.mock("./aircraft/AircraftResourceGroupAssignmentDialog", () => ({
  AircraftResourceGroupAssignmentDialog: () => null,
}));
vi.mock("./FactoryResetDialog", () => ({ FactoryResetDialog: () => null }));
vi.mock("./gates/GateEditorDialog", () => ({ GateEditorDialog: () => null }));
vi.mock("./master-data/MasterDataManagementDialogs", () => ({
  MasterDataDeleteDialog: ({ onConfirm }: { onConfirm: () => void }) => (
    <button onClick={onConfirm} type="button">
      Confirm deletion
    </button>
  ),
  MasterDataTemplateImportDialog: () => null,
}));
vi.mock("./master-data/ResourceAircraftEditorDialog", () => ({
  ResourceAircraftEditorDialog: ({
    onAssignAircraft,
  }: {
    onAssignAircraft: (resourceGroupId: string) => void;
  }) => (
    <button onClick={() => onAssignAircraft("group-a")} type="button">
      Assign resource aircraft
    </button>
  ),
}));
vi.mock("./pilots/PilotEditorDialog", () => ({ PilotEditorDialog: () => null }));
vi.mock("./products/ProductEditorDialog", () => ({ ProductEditorDialog: () => null }));
vi.mock("./products/ProductSalesDialog", () => ({
  ProductSalesDialog: ({
    onSaveClosing,
    onToggleSales,
    product,
  }: {
    onSaveClosing: (remove: boolean) => void;
    onToggleSales: () => void;
    product: OperationBoard["products"][number] | null;
  }) =>
    product ? (
      <div>
        <button onClick={onToggleSales} type="button">
          Toggle product sales
        </button>
        <button onClick={() => onSaveClosing(true)} type="button">
          Remove closing
        </button>
      </div>
    ) : null,
}));

const product = {
  id: "product-a",
  saleEnabled: true,
} as OperationBoard["products"][number];
const board = {
  event: { status: "PREPARATION", timeZone: "Europe/Berlin" },
  products: [product],
  resourceGroups: [],
} as unknown as OperationBoard;

function renderDialogs({ discardChangesOpen = false } = {}) {
  const configureProductSales = vi.fn().mockResolvedValue(undefined);
  const requestAdminAction = vi.fn((action: () => Promise<void>) => action());
  const runBusyAction = vi.fn((_key: string, action: () => Promise<void>) => action());
  const setAssignmentContext = vi.fn();
  const confirmDeletion = vi.fn().mockResolvedValue(undefined);
  const continueEditing = vi.fn();
  const discardChanges = vi.fn();

  render(
    <AdminShellDialogs
      administrator
      assignmentContext={null}
      authorization={
        {
          busy: false,
          closeDialog: vi.fn(),
          confirmDialog: vi.fn(),
          dialogMode: null,
          error: null,
          inputRef: { current: null },
          modeUnlocked: true,
          pin: "123456",
          setPin: vi.fn(),
        } as never
      }
      board={board}
      busyActionKey={null}
      cancelPendingNavigation={vi.fn()}
      category="resource-groups"
      confirmPendingNavigation={vi.fn()}
      deletion={
        {
          cancelDeletion: vi.fn(),
          confirmDeletion,
          pendingDeletion: null,
        } as never
      }
      discardEventNavigationOpen={false}
      editorFooter={null}
      editorFurtherActions={null}
      editorPresentation={{ initialFocusSelector: "input" } as never}
      editors={{ aircraft: {}, gate: {}, pilot: {}, product: {}, resourceGroup: {} } as never}
      editorState={
        {
          continueEditing,
          dirty: false,
          discardChanges,
          discardChangesOpen,
          open: false,
          requestClose: vi.fn(),
          setTab: vi.fn(),
          submitAttempted: false,
          tab: "details",
        } as never
      }
      factoryReset={{ open: false } as never}
      masterDataActions={
        {
          configureProductSales,
          requestAircraftAssignment: vi.fn(),
          requestMasterSave: vi.fn(),
          requestTurnaroundOverrideSave: vi.fn(),
        } as never
      }
      masterDataStepActive
      products={[product]}
      requestAdminAction={requestAdminAction}
      resourceGroups={[]}
      runBusyAction={runBusyAction}
      saleClosesAt="2026-08-10T16:00"
      salesProductId="product-a"
      setAssignmentContext={setAssignmentContext}
      setSaleClosesAt={vi.fn()}
      setSalesProductId={vi.fn()}
      setTurnaroundContext={vi.fn()}
      templateImport={{ open: false } as never}
      turnaroundContext={null}
    />,
  );

  return {
    configureProductSales,
    confirmDeletion,
    continueEditing,
    discardChanges,
    requestAdminAction,
    runBusyAction,
    setAssignmentContext,
  };
}

afterEach(cleanup);

describe("admin shell dialogs", () => {
  it("keeps product sales commands behind authorization and the busy boundary", () => {
    const actions = renderDialogs();

    fireEvent.click(screen.getByRole("button", { name: "Toggle product sales" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove closing" }));

    expect(actions.requestAdminAction).toHaveBeenCalledTimes(2);
    expect(actions.runBusyAction).toHaveBeenNthCalledWith(
      1,
      "product-product-a-sales",
      expect.any(Function),
    );
    expect(actions.runBusyAction).toHaveBeenNthCalledWith(
      2,
      "product-product-a-closing",
      expect.any(Function),
    );
    expect(actions.configureProductSales).toHaveBeenNthCalledWith(1, product, false);
    expect(actions.configureProductSales).toHaveBeenNthCalledWith(2, product, true, null);
  });

  it("maps resource assignment and deletion dialogs to their feature actions", () => {
    const actions = renderDialogs();

    fireEvent.click(screen.getByRole("button", { name: "Assign resource aircraft" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));

    expect(actions.setAssignmentContext).toHaveBeenCalledWith({
      mode: "resource-group",
      resourceGroupId: "group-a",
    });
    expect(actions.runBusyAction).toHaveBeenCalledWith("master-delete", actions.confirmDeletion);
  });

  it("keeps dirty-editor recovery in a single destructive confirmation dialog", () => {
    const actions = renderDialogs({ discardChangesOpen: true });

    expect(screen.getByRole("alertdialog", { name: "Änderungen verwerfen?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Weiter bearbeiten" }));
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));

    expect(actions.continueEditing).toHaveBeenCalledOnce();
    expect(actions.discardChanges).toHaveBeenCalledOnce();
  });
});
