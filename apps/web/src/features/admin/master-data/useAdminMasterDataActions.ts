import type { OperationBoard } from "@rundflug/contracts";
import type { MasterDataCategory } from "../../../admin-ux";
import { sendCommand } from "../../../api";
import { MASTER_DATA_AUDIT_REASON, OPERATIONAL_AUDIT_REASON } from "../../../operation-workspace";
import { useAdminOperationIdentity } from "../../operations/operation-identity";
import type { useAircraftEditorState } from "../aircraft/useAircraftEditorState";
import type { useGateEditorState } from "../gates/useGateEditorState";
import type { usePilotEditorState } from "../pilots/usePilotEditorState";
import type { useProductEditorState } from "../products/useProductEditorState";
import type { useResourceGroupEditorState } from "../resource-groups/useResourceGroupEditorState";
import {
  invalidAircraftField,
  invalidProductField,
  invalidResourceGroupField,
} from "./admin-master-data-validation";

interface TurnaroundOverrideValues {
  boarding: number | null;
  deboarding: number | null;
  buffer: number | null;
}

interface UseAdminMasterDataActionsOptions {
  administrator: boolean;
  board: OperationBoard | null;
  category: MasterDataCategory;
  clearPinWhenLocked: () => void;
  editors: {
    aircraft: ReturnType<typeof useAircraftEditorState>;
    gate: ReturnType<typeof useGateEditorState>;
    pilot: ReturnType<typeof usePilotEditorState>;
    product: ReturnType<typeof useProductEditorState>;
    resourceGroup: ReturnType<typeof useResourceGroupEditorState>;
  };
  finishEditor: () => void;
  getAdminPin: () => string;
  onAssignmentComplete: () => void;
  onManifestCorrected: () => void;
  onMessage: (message: string) => void;
  onSalesComplete: () => void;
  refreshBoard: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  requestAdminAction: (action: () => Promise<void>) => void | Promise<void>;
  runBusyAction: (key: string, action: () => Promise<void>) => Promise<void>;
  selectAircraft: (id: string) => void;
  selectProduct: (id: string) => void;
  selectResourceGroup: (id: string) => void;
  setSubmitAttempted: (attempted: boolean) => void;
}

export function useAdminMasterDataActions({
  administrator,
  board,
  category,
  clearPinWhenLocked,
  editors,
  finishEditor,
  getAdminPin,
  onAssignmentComplete,
  onManifestCorrected,
  onMessage,
  onSalesComplete,
  refreshBoard,
  refreshHistory,
  requestAdminAction,
  runBusyAction,
  selectAircraft,
  selectProduct,
  selectResourceGroup,
  setSubmitAttempted,
}: UseAdminMasterDataActionsOptions) {
  const {
    eventId: EVENT_ID,
    deviceId: ADMIN_DEVICE_ID,
    deviceToken: ADMIN_DEVICE_TOKEN,
  } = useAdminOperationIdentity();
  const { aircraft: aircraftEditor, gate: gateEditor, pilot: pilotEditor } = editors;
  const { product: productEditor, resourceGroup: resourceEditor } = editors;
  const productPriceCents = productEditor.priceCents;

  async function saveGate() {
    if (!board || gateEditor.label.trim().length < 2 || getAdminPin().length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_GATE",
          payload: {
            gateId: gateEditor.editorId === "new" ? crypto.randomUUID() : gateEditor.editorId,
            label: gateEditor.label.trim(),
            gateType: gateEditor.gateType,
            active: gateEditor.active,
            sortOrder: gateEditor.sortOrder,
            travelLeadMinutes: gateEditor.travelLeadMinutes,
            displayFilter: gateEditor.displayFilter,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: getAdminPin(),
          },
        },
        ADMIN_DEVICE_TOKEN,
      );
      onMessage("Gate-Stammdaten wurden protokolliert gespeichert.");
      clearPinWhenLocked();
      finishEditor();
      gateEditor.resetAfterSave();
      await refreshBoard();
      await refreshHistory();
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : "Gate konnte nicht gespeichert werden.");
    }
  }

  async function correctRotationManifest(
    ticketGroupId: string,
    targetRotationId: string,
    correctionReason: string,
  ) {
    if (
      !board ||
      !ticketGroupId ||
      !targetRotationId ||
      correctionReason.trim().length < 10 ||
      getAdminPin().length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CORRECT_ROTATION_MANIFEST",
          payload: {
            ticketGroupId,
            targetRotationId,
            reason: correctionReason.trim(),
            adminPin: getAdminPin(),
          },
        },
        ADMIN_DEVICE_TOKEN,
      );
      onManifestCorrected();
      onMessage("Dokumentierte Besetzung wurde als Admin-Korrektur vollständig auditiert.");
      clearPinWhenLocked();
      await refreshBoard();
      await refreshHistory();
    } catch (cause) {
      onMessage(
        cause instanceof Error
          ? cause.message
          : "Manifestkorrektur konnte nicht gespeichert werden.",
      );
    }
  }

  function requestManifestCorrection(
    ticketGroupId: string,
    targetRotationId: string,
    correctionReason: string,
  ) {
    requestAdminAction(() =>
      runBusyAction("manifest-correction", () =>
        correctRotationManifest(ticketGroupId, targetRotationId, correctionReason),
      ),
    );
  }

  async function saveProduct() {
    if (
      !board ||
      !productEditor.resourceGroupId ||
      !productEditor.gateId ||
      productPriceCents === null ||
      getAdminPin().length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_PRODUCT",
          payload: {
            productId:
              productEditor.editorId === "new" ? crypto.randomUUID() : productEditor.editorId,
            resourceGroupId: productEditor.resourceGroupId,
            gateId: productEditor.gateId,
            name: productEditor.name.trim(),
            code: productEditor.code.trim().toUpperCase(),
            publicDescription: productEditor.description.trim(),
            priceCents: productPriceCents,
            referenceCapacity:
              board.resourceGroups.find((group) => group.id === productEditor.resourceGroupId)
                ?.referenceCapacity ?? 1,
            referenceDurationMinutes: productEditor.referenceDuration,
            promisedFlightMinutes: productEditor.promisedFlightMinutes,
            plannedBoardingMinutesOverride:
              productEditor.boardingOverride === "" ? null : Number(productEditor.boardingOverride),
            plannedDeboardingMinutesOverride:
              productEditor.deboardingOverride === ""
                ? null
                : Number(productEditor.deboardingOverride),
            plannedBufferMinutesOverride:
              productEditor.bufferOverride === "" ? null : Number(productEditor.bufferOverride),
            childCompanionRequired: productEditor.childCompanion,
            weightClasses: productEditor.weightClasses,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: getAdminPin(),
          },
        },
        ADMIN_DEVICE_TOKEN,
      );
      onMessage("Produktstammdaten wurden protokolliert gespeichert.");
      clearPinWhenLocked();
      selectProduct("new");
      finishEditor();
      await refreshBoard();
      await refreshHistory();
    } catch (cause) {
      onMessage(
        cause instanceof Error ? cause.message : "Produkt konnte nicht gespeichert werden.",
      );
    }
  }

  async function persistTurnaroundOverride(
    aircraftId: string,
    productId: string,
    values: TurnaroundOverrideValues,
  ) {
    if (!board) return;
    const existing = board.aircraftProductTurnaroundOverrides.find(
      (override) => override.productId === productId && override.aircraftId === aircraftId,
    );
    const inheritAll =
      values.boarding === null && values.deboarding === null && values.buffer === null;
    if (inheritAll && !existing) return;
    try {
      await sendCommand(
        inheritAll && existing
          ? {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE",
              payload: {
                aircraftId,
                productId,
                expectedOverrideVersion: existing.version,
                reason: MASTER_DATA_AUDIT_REASON,
                adminPin: getAdminPin(),
              },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE",
              payload: {
                aircraftId,
                productId,
                plannedBoardingMinutesOverride: values.boarding,
                plannedDeboardingMinutesOverride: values.deboarding,
                plannedBufferMinutesOverride: values.buffer,
                expectedOverrideVersion: existing?.version ?? 0,
                reason: MASTER_DATA_AUDIT_REASON,
                adminPin: getAdminPin(),
              },
            },
        ADMIN_DEVICE_TOKEN,
      );
      onMessage(
        inheritAll
          ? "Die Bodenzeiten erben wieder unmittelbar von Produkt oder Veranstaltung."
          : "Flugzeugspezifische Bodenzeiten wurden protokolliert gespeichert.",
      );
      await refreshBoard();
      await refreshHistory();
    } catch (cause) {
      onMessage(
        cause instanceof Error
          ? cause.message
          : "Flugzeugspezifische Bodenzeiten konnten nicht gespeichert werden.",
      );
    }
  }

  function requestTurnaroundOverrideSave(
    aircraftId: string,
    productId: string,
    values: TurnaroundOverrideValues,
  ) {
    if (!administrator) {
      onMessage("Für Änderungen am Zeitmodell wird ein Administrationskonto benötigt.");
      return;
    }
    requestAdminAction(() =>
      runBusyAction(`turnaround-${aircraftId}-${productId}`, () =>
        persistTurnaroundOverride(aircraftId, productId, values),
      ),
    );
  }

  async function saveResourceGroup() {
    if (
      !board ||
      !resourceEditor.gateId ||
      resourceEditor.name.trim().length < 2 ||
      !/^[A-Z0-9-]{2,8}$/.test(resourceEditor.shortCode.trim().toUpperCase()) ||
      getAdminPin().length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_RESOURCE_GROUP",
          payload: {
            resourceGroupId:
              resourceEditor.editorId === "new" ? crypto.randomUUID() : resourceEditor.editorId,
            name: resourceEditor.name.trim(),
            shortCode: resourceEditor.shortCode.trim().toUpperCase(),
            gateId: resourceEditor.gateId,
            referenceCapacity: resourceEditor.currentGroup?.referenceCapacity ?? 1,
            compatibleAircraftTypes: [],
            automaticPrecallEnabled: resourceEditor.automaticPrecall,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: getAdminPin(),
          },
        },
        ADMIN_DEVICE_TOKEN,
      );
      onMessage(
        "Ressourcengruppe wurde protokolliert gespeichert; Zuordnungen bleiben unverändert.",
      );
      clearPinWhenLocked();
      selectResourceGroup("new");
      finishEditor();
      await refreshBoard();
      await refreshHistory();
    } catch (cause) {
      onMessage(
        cause instanceof Error
          ? cause.message
          : "Ressourcengruppe konnte nicht gespeichert werden.",
      );
    }
  }

  async function saveAircraft() {
    if (
      !board ||
      aircraftEditor.registration.trim().length < 3 ||
      aircraftEditor.type.trim().length < 2 ||
      getAdminPin().length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_AIRCRAFT",
          payload: {
            aircraftId:
              aircraftEditor.editorId === "new" ? crypto.randomUUID() : aircraftEditor.editorId,
            registration: aircraftEditor.registration.trim().toUpperCase(),
            aircraftType: aircraftEditor.type.trim(),
            passengerSeats: aircraftEditor.passengerSeats,
            maximumPassengerPayloadKg: aircraftEditor.maximumPassengerPayloadKg
              ? Number(aircraftEditor.maximumPassengerPayloadKg)
              : null,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: getAdminPin(),
          },
        },
        ADMIN_DEVICE_TOKEN,
      );
      onMessage("Flugzeugstammdaten wurden protokolliert gespeichert.");
      clearPinWhenLocked();
      selectAircraft("new");
      finishEditor();
      await refreshBoard();
      await refreshHistory();
    } catch (cause) {
      onMessage(
        cause instanceof Error ? cause.message : "Flugzeug konnte nicht gespeichert werden.",
      );
    }
  }

  async function assignAircraft(aircraftId: string, resourceGroupId: string) {
    if (!board || !aircraftId || !resourceGroupId || getAdminPin().length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "ASSIGN_AIRCRAFT_RESOURCE_GROUP",
          payload: {
            aircraftId,
            resourceGroupId,
            effectiveAt: new Date().toISOString(),
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: getAdminPin(),
          },
        },
        ADMIN_DEVICE_TOKEN,
      );
      onMessage(
        "Flugzeugzuordnung wurde historisiert geändert; Queue und Prognose werden neu berechnet.",
      );
      clearPinWhenLocked();
      onAssignmentComplete();
      finishEditor();
      await refreshBoard();
      await refreshHistory();
    } catch (cause) {
      onMessage(
        cause instanceof Error ? cause.message : "Flugzeugzuordnung konnte nicht geändert werden.",
      );
    }
  }

  function requestAircraftAssignment(aircraftId: string, resourceGroupId: string) {
    if (!administrator) {
      onMessage("Für Flugzeugzuordnungen wird ein Administrationskonto benötigt.");
      return;
    }
    requestAdminAction(() =>
      runBusyAction("master-assignment", () => assignAircraft(aircraftId, resourceGroupId)),
    );
  }

  async function emergency(
    type: "TRIGGER_EMERGENCY" | "CLEAR_EMERGENCY",
    emergencyReason: string,
  ): Promise<boolean> {
    if (
      !board ||
      emergencyReason.trim().length < 3 ||
      (type === "CLEAR_EMERGENCY" && getAdminPin().length < 4)
    )
      return false;
    try {
      await sendCommand(
        type === "TRIGGER_EMERGENCY"
          ? {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type,
              payload: { reason: emergencyReason.trim() },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type,
              payload: { reason: emergencyReason.trim(), adminPin: getAdminPin() },
            },
        ADMIN_DEVICE_TOKEN,
      );
      onMessage(
        type === "TRIGGER_EMERGENCY" ? "Notfallmodus ausgelöst." : "Notfallmodus aufgehoben.",
      );
      clearPinWhenLocked();
      await refreshBoard();
      await refreshHistory();
      return true;
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : "Notfallkommando fehlgeschlagen.");
      return false;
    }
  }

  async function configureProductSales(
    product: OperationBoard["products"][number],
    saleEnabled: boolean,
    closingTimeOverride?: string | null,
  ) {
    if (!board || getAdminPin().length < 4) return;
    try {
      const configuredClosing =
        closingTimeOverride === undefined ? product.saleClosesAt : closingTimeOverride;
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CONFIGURE_PRODUCT_SALES",
          payload: {
            productId: product.id,
            saleEnabled,
            saleClosesAt: configuredClosing,
            warningThreshold: product.capacityWarningThreshold,
            criticalThreshold: product.capacityCriticalThreshold,
            reason: OPERATIONAL_AUDIT_REASON,
            adminPin: getAdminPin(),
          },
        },
        ADMIN_DEVICE_TOKEN,
      );
      onMessage("Verkaufssteuerung wurde protokolliert aktualisiert.");
      onSalesComplete();
      await refreshBoard();
      await refreshHistory();
    } catch (cause) {
      onMessage(cause instanceof Error ? cause.message : "Verkaufssteuerung fehlgeschlagen.");
    }
  }

  async function upsertPilot(
    pilotId: string,
    operationalCode: string,
    operationalNote: string,
    active: boolean,
  ) {
    if (!board || getAdminPin().length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_PILOT",
          payload: {
            pilotId,
            operationalCode: operationalCode.trim().toUpperCase(),
            operationalNote: operationalNote.trim(),
            active,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: getAdminPin(),
          },
        },
        ADMIN_DEVICE_TOKEN,
      );
      onMessage("Anonymer operativer Pilotencode wurde aktualisiert.");
      clearPinWhenLocked();
      pilotEditor.resetAfterSave();
      finishEditor();
      await refreshBoard();
      await refreshHistory();
    } catch (cause) {
      onMessage(
        cause instanceof Error ? cause.message : "Pilotencode konnte nicht geändert werden.",
      );
    }
  }

  function requestMasterSave(
    action: "gate" | "resource-group" | "aircraft" | "pilot" | "pilot-toggle" | "product",
    valid: boolean,
    invalidFieldId?: string,
  ) {
    setSubmitAttempted(true);
    if (!administrator) {
      onMessage("Für Stammdatenänderungen wird ein Administrationskonto benötigt.");
      return;
    }
    if (!valid) {
      if (invalidFieldId) {
        window.requestAnimationFrame(() => document.getElementById(invalidFieldId)?.focus());
      }
      return;
    }
    requestAdminAction(() =>
      runBusyAction(`master-${action}`, async () => {
        if (action === "gate") await saveGate();
        if (action === "resource-group") await saveResourceGroup();
        if (action === "aircraft") await saveAircraft();
        if (action === "product") await saveProduct();
        if (action === "pilot") {
          await upsertPilot(
            pilotEditor.editorId === "new" ? crypto.randomUUID() : pilotEditor.editorId,
            pilotEditor.code,
            pilotEditor.note,
            pilotEditor.currentPilot?.active ?? true,
          );
        }
        if (action === "pilot-toggle") {
          const existing = pilotEditor.currentPilot;
          if (existing) {
            await upsertPilot(
              existing.id,
              existing.operationalCode,
              existing.operationalNote,
              !existing.active,
            );
          }
        }
      }),
    );
  }

  function requestProductSave() {
    setSubmitAttempted(true);
    const invalidFieldId = invalidProductField(productEditor, productPriceCents);
    if (invalidFieldId) {
      window.requestAnimationFrame(() => document.getElementById(invalidFieldId)?.focus());
      return;
    }
    requestMasterSave("product", true);
  }

  function requestCurrentMasterSave() {
    if (category === "gates") {
      requestMasterSave("gate", gateEditor.label.trim().length >= 2, "gate-label");
      return;
    }
    if (category === "products") {
      requestProductSave();
      return;
    }
    if (category === "resource-groups") {
      const invalidFieldId = invalidResourceGroupField(resourceEditor);
      requestMasterSave("resource-group", !invalidFieldId, invalidFieldId);
      return;
    }
    if (category === "aircraft") {
      const invalidFieldId = invalidAircraftField(aircraftEditor);
      requestMasterSave("aircraft", !invalidFieldId, invalidFieldId);
      return;
    }
    requestMasterSave(
      "pilot",
      /^[A-Z0-9-]{2,12}$/.test(pilotEditor.code),
      "pilot-operational-code",
    );
  }

  return {
    configureProductSales,
    emergency,
    requestAircraftAssignment,
    requestCurrentMasterSave,
    requestManifestCorrection,
    requestMasterSave,
    requestTurnaroundOverrideSave,
  };
}
