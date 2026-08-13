import type { OperationBoard } from "@rundflug/contracts";
import type { ReactNode } from "react";
import type { MasterDataCategory } from "../../admin-ux";
import { Button, ConfirmationDialog, ModalDialog } from "../../design-system/components";
import { eventLocalDateTimeToIso } from "../../event-time";
import { AdminAuthorizationDialog } from "./AdminAuthorizationDialog";
import {
  AircraftProductTurnaroundOverrideDialog,
  type TurnaroundOverrideContext,
} from "./aircraft/AircraftProductTurnaroundOverrideDialog";
import {
  type AircraftResourceGroupAssignmentContext,
  AircraftResourceGroupAssignmentDialog,
} from "./aircraft/AircraftResourceGroupAssignmentDialog";
import type { useAircraftEditorState } from "./aircraft/useAircraftEditorState";
import { FactoryResetDialog } from "./FactoryResetDialog";
import { GateEditorDialog } from "./gates/GateEditorDialog";
import type { useGateEditorState } from "./gates/useGateEditorState";
import type { getAdminMasterEditorPresentation } from "./master-data/AdminMasterEditorActions";
import {
  MasterDataDeleteDialog,
  MasterDataTemplateImportDialog,
} from "./master-data/MasterDataManagementDialogs";
import { ResourceAircraftEditorDialog } from "./master-data/ResourceAircraftEditorDialog";
import type { useAdminMasterDataActions } from "./master-data/useAdminMasterDataActions";
import type { useAdminMasterDataDeletion } from "./master-data/useAdminMasterDataDeletion";
import type { useAdminMasterEditorState } from "./master-data/useAdminMasterEditorState";
import type { useMasterDataTemplateImport } from "./master-data/useMasterDataTemplateImport";
import { PilotEditorDialog } from "./pilots/PilotEditorDialog";
import type { usePilotEditorState } from "./pilots/usePilotEditorState";
import { ProductEditorDialog } from "./products/ProductEditorDialog";
import { ProductSalesDialog } from "./products/ProductSalesDialog";
import type { useProductEditorState } from "./products/useProductEditorState";
import type { useResourceGroupEditorState } from "./resource-groups/useResourceGroupEditorState";
import type { useAdminAuthorization } from "./useAdminAuthorization";
import type { useAdminFactoryReset } from "./useAdminFactoryReset";

type RunBusyAction = (key: string, action: () => Promise<void>) => Promise<void>;

function productSalesBusyAction(productId: string | null, busyActionKey: string | null) {
  if (!productId || !busyActionKey) return null;
  if (busyActionKey === `product-${productId}-closing`) return "closing";
  return busyActionKey === `product-${productId}-sales` ? "toggle" : null;
}

interface AdminShellDialogsProps {
  administrator: boolean;
  assignmentContext: AircraftResourceGroupAssignmentContext | null;
  authorization: ReturnType<typeof useAdminAuthorization>;
  board: OperationBoard | null;
  busyActionKey: string | null;
  cancelPendingNavigation: () => void;
  category: MasterDataCategory;
  confirmPendingNavigation: () => void;
  deletion: ReturnType<typeof useAdminMasterDataDeletion>;
  discardEventNavigationOpen: boolean;
  editorFooter: ReactNode;
  editorFurtherActions: ReactNode;
  editorPresentation: ReturnType<typeof getAdminMasterEditorPresentation>;
  editors: {
    aircraft: ReturnType<typeof useAircraftEditorState>;
    gate: ReturnType<typeof useGateEditorState>;
    pilot: ReturnType<typeof usePilotEditorState>;
    product: ReturnType<typeof useProductEditorState>;
    resourceGroup: ReturnType<typeof useResourceGroupEditorState>;
  };
  editorState: ReturnType<typeof useAdminMasterEditorState>;
  factoryReset: ReturnType<typeof useAdminFactoryReset>;
  masterDataActions: ReturnType<typeof useAdminMasterDataActions>;
  masterDataStepActive: boolean;
  products: OperationBoard["products"];
  requestAdminAction: (action: () => Promise<void>) => void | Promise<void>;
  resourceGroups: OperationBoard["resourceGroups"];
  runBusyAction: RunBusyAction;
  saleClosesAt: string;
  salesProductId: string | null;
  setAssignmentContext: (context: AircraftResourceGroupAssignmentContext | null) => void;
  setSaleClosesAt: (value: string) => void;
  setSalesProductId: (productId: string | null) => void;
  setTurnaroundContext: (context: TurnaroundOverrideContext | null) => void;
  templateImport: ReturnType<typeof useMasterDataTemplateImport>;
  turnaroundContext: TurnaroundOverrideContext | null;
}

export function AdminShellDialogs({
  administrator,
  assignmentContext,
  authorization,
  board,
  busyActionKey,
  cancelPendingNavigation,
  category,
  confirmPendingNavigation,
  deletion,
  discardEventNavigationOpen,
  editorFooter,
  editorFurtherActions,
  editorPresentation,
  editors,
  editorState,
  factoryReset,
  masterDataActions,
  masterDataStepActive,
  products,
  requestAdminAction,
  resourceGroups,
  runBusyAction,
  saleClosesAt,
  salesProductId,
  setAssignmentContext,
  setSaleClosesAt,
  setSalesProductId,
  setTurnaroundContext,
  templateImport,
  turnaroundContext,
}: Readonly<AdminShellDialogsProps>) {
  const selectedProduct = board?.products.find((product) => product.id === salesProductId) ?? null;

  return (
    <>
      {board ? (
        <AircraftResourceGroupAssignmentDialog
          board={board}
          busy={busyActionKey === "master-assignment"}
          context={assignmentContext}
          onClose={() => setAssignmentContext(null)}
          onConfirm={masterDataActions.requestAircraftAssignment}
        />
      ) : null}
      {board ? (
        <AircraftProductTurnaroundOverrideDialog
          board={board}
          busyKey={busyActionKey}
          context={turnaroundContext}
          onClose={() => setTurnaroundContext(null)}
          onSave={masterDataActions.requestTurnaroundOverrideSave}
        />
      ) : null}
      {board ? (
        <ProductSalesDialog
          busyAction={productSalesBusyAction(salesProductId, busyActionKey)}
          closingValue={saleClosesAt}
          eventStatus={board.event.status}
          key={salesProductId ?? "closed"}
          onClose={() => setSalesProductId(null)}
          onClosingChange={setSaleClosesAt}
          onSaveClosing={(remove) => {
            if (!selectedProduct) return;
            const closingTime = remove
              ? null
              : eventLocalDateTimeToIso(saleClosesAt, board.event.timeZone);
            requestAdminAction(() =>
              runBusyAction(`product-${selectedProduct.id}-closing`, () =>
                masterDataActions.configureProductSales(
                  selectedProduct,
                  selectedProduct.saleEnabled,
                  closingTime,
                ),
              ),
            );
          }}
          onToggleSales={() => {
            if (!selectedProduct) return;
            requestAdminAction(() =>
              runBusyAction(`product-${selectedProduct.id}-sales`, () =>
                masterDataActions.configureProductSales(
                  selectedProduct,
                  !selectedProduct.saleEnabled,
                ),
              ),
            );
          }}
          product={selectedProduct}
        />
      ) : null}
      <GateEditorDialog
        editor={editors.gate}
        footer={editorFooter}
        furtherActions={editorFurtherActions}
        initialFocusSelector={editorPresentation.initialFocusSelector}
        onClose={editorState.requestClose}
        onTabChange={editorState.setTab}
        open={masterDataStepActive && editorState.open && category === "gates"}
        products={products}
        resourceGroups={resourceGroups}
        submitAttempted={editorState.submitAttempted}
        tab={editorState.tab}
      />
      <ProductEditorDialog
        board={board}
        editor={editors.product}
        footer={editorFooter}
        furtherActions={editorFurtherActions}
        initialFocusSelector={editorPresentation.initialFocusSelector}
        onClose={editorState.requestClose}
        onTabChange={editorState.setTab}
        open={masterDataStepActive && editorState.open && category === "products"}
        resourceGroups={resourceGroups}
        submitAttempted={editorState.submitAttempted}
        tab={editorState.tab}
      />
      <ResourceAircraftEditorDialog
        aircraftEditor={editors.aircraft}
        board={board}
        category={category}
        footer={editorFooter}
        furtherActions={editorFurtherActions}
        initialFocusSelector={editorPresentation.initialFocusSelector}
        onAssignAircraft={(resourceGroupId) =>
          setAssignmentContext({ mode: "resource-group", resourceGroupId })
        }
        onClose={editorState.requestClose}
        open={
          masterDataStepActive &&
          editorState.open &&
          ["resource-groups", "aircraft"].includes(category)
        }
        resourceEditor={editors.resourceGroup}
        submitAttempted={editorState.submitAttempted}
      />
      <PilotEditorDialog
        administrator={administrator}
        busy={busyActionKey === "master-pilot-toggle"}
        dirty={editorState.dirty}
        editor={editors.pilot}
        footer={editorFooter}
        furtherActions={editorFurtherActions}
        initialFocusSelector={editorPresentation.initialFocusSelector}
        onClose={editorState.requestClose}
        onToggle={() => masterDataActions.requestMasterSave("pilot-toggle", true)}
        open={masterDataStepActive && editorState.open && category === "pilots"}
        submitAttempted={editorState.submitAttempted}
      />
      <ModalDialog
        className="master-discard-dialog"
        footer={
          <>
            <Button
              data-master-discard-continue
              onClick={editorState.continueEditing}
              type="button"
            >
              Weiter bearbeiten
            </Button>
            <Button onClick={editorState.discardChanges} type="button" variant="danger">
              Verwerfen
            </Button>
          </>
        }
        initialFocusSelector="[data-master-discard-continue]"
        onClose={editorState.continueEditing}
        open={editorState.discardChangesOpen}
        role="alertdialog"
        size="compact"
        title="Änderungen verwerfen?"
      >
        <p className="master-discard-copy">
          Die noch nicht gespeicherten Änderungen gehen verloren. Dieser Vorgang kann nicht
          rückgängig gemacht werden.
        </p>
      </ModalDialog>
      <AdminAuthorizationDialog
        busy={authorization.busy}
        error={authorization.error}
        inputRef={authorization.inputRef}
        mode={authorization.dialogMode}
        onClose={authorization.closeDialog}
        onPinChange={authorization.setPin}
        onSubmit={() => void authorization.confirmDialog()}
        pin={authorization.pin}
      />
      <MasterDataDeleteDialog
        busy={busyActionKey === "master-delete"}
        eventStatus={board?.event.status}
        inputRef={authorization.inputRef}
        modeUnlocked={authorization.modeUnlocked}
        onCancel={deletion.cancelDeletion}
        onConfirm={() => void runBusyAction("master-delete", deletion.confirmDeletion)}
        onPinChange={authorization.setPin}
        pin={authorization.pin}
        target={deletion.pendingDeletion}
      />
      <MasterDataTemplateImportDialog
        busy={templateImport.busy}
        draft={templateImport.draft}
        error={templateImport.error}
        fileName={templateImport.fileName}
        onClose={templateImport.closeDialog}
        onFile={(file) => void templateImport.readFile(file)}
        onImport={() => void templateImport.applyTemplate()}
        open={templateImport.open}
        validation={templateImport.validation}
      />
      <ConfirmationDialog
        body={
          <p>
            Die ungespeicherten Veranstaltungsparameter gehen beim Verlassen dieser Ansicht
            verloren.
          </p>
        }
        confirmLabel="Verwerfen und wechseln"
        danger
        onCancel={cancelPendingNavigation}
        onConfirm={confirmPendingNavigation}
        open={discardEventNavigationOpen}
        title="Ungespeicherte Änderungen verwerfen?"
      />
      <FactoryResetDialog
        busy={factoryReset.busy}
        confirmation={factoryReset.confirmation}
        deleteAllBackups={factoryReset.deleteAllBackups}
        error={factoryReset.error}
        onClose={factoryReset.closeDialog}
        onConfirmationChange={factoryReset.setConfirmation}
        onDeleteAllBackupsChange={factoryReset.setDeleteAllBackups}
        onPinChange={factoryReset.setPin}
        onReasonChange={factoryReset.setReason}
        onRetainRecoveryBackupChange={factoryReset.setRetainRecoveryBackup}
        onSubmit={() => void factoryReset.performReset()}
        open={factoryReset.open}
        pin={factoryReset.pin}
        reason={factoryReset.reason}
        retainRecoveryBackup={factoryReset.retainRecoveryBackup}
      />
    </>
  );
}
