// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MasterDataCategory } from "../../../admin-ux";
import { useAdminMasterDataActions } from "./useAdminMasterDataActions";

const mocks = vi.hoisted(() => ({ sendCommand: vi.fn() }));

vi.mock("../../../api", () => ({ sendCommand: mocks.sendCommand }));
vi.mock("../../../operation-workspace", () => ({
  MASTER_DATA_AUDIT_REASON: "Synthetic master-data change",
  OPERATIONAL_AUDIT_REASON: "Synthetic operational change",
}));
vi.mock("../../operations/operation-identity", () => ({
  useAdminOperationIdentity: () => ({
    eventId: "synthetic-event",
    deviceId: "synthetic-admin-device",
    deviceToken: "synthetic-device-token",
  }),
}));

const baseBoard = {
  aircraftProductTurnaroundOverrides: [],
  event: { version: 17 },
  resourceGroups: [{ id: "group-a", referenceCapacity: 4 }],
} as unknown as OperationBoard;

const baseEditors = {
  aircraft: {
    editorId: "aircraft-a",
    maximumPassengerPayloadKg: "350",
    passengerSeats: 4,
    registration: " d-eaaa ",
    type: "C172",
  },
  gate: {
    active: true,
    displayFilter: "ALL",
    editorId: "gate-a",
    gateType: "PHYSICAL",
    label: " Gate A ",
    resetAfterSave: vi.fn(),
    sortOrder: 1,
    travelLeadMinutes: 5,
  },
  pilot: {
    code: "P-01",
    currentPilot: null,
    editorId: "pilot-a",
    note: "Synthetic pilot",
    resetAfterSave: vi.fn(),
  },
  product: {
    boardingOverride: "",
    bufferOverride: "",
    childCompanion: false,
    code: "PAN",
    deboardingOverride: "",
    description: "Synthetic product",
    editorId: "product-a",
    gateId: "gate-a",
    name: "Panorama",
    priceCents: 2500,
    promisedFlightMinutes: 15,
    referenceDuration: 20,
    resourceGroupId: "group-a",
    weightClasses: [],
  },
  resourceGroup: {
    automaticPrecall: true,
    currentGroup: { referenceCapacity: 4 },
    editorId: "group-a",
    gateId: "gate-a",
    name: "Panorama-Gruppe",
    shortCode: "PA",
  },
};

function renderActions({
  administrator = true,
  board = baseBoard,
  category = "gates",
}: {
  administrator?: boolean;
  board?: OperationBoard;
  category?: MasterDataCategory;
} = {}) {
  const clearPinWhenLocked = vi.fn();
  const finishEditor = vi.fn();
  const onAssignmentComplete = vi.fn();
  const onManifestCorrected = vi.fn();
  const onMessage = vi.fn();
  const onSalesComplete = vi.fn();
  const refreshBoard = vi.fn(async () => undefined);
  const refreshHistory = vi.fn(async () => undefined);
  const requestAdminAction = vi.fn((action: () => Promise<void>) => action());
  const runBusyAction = vi.fn((_key: string, action: () => Promise<void>) => action());
  const selectAircraft = vi.fn();
  const selectProduct = vi.fn();
  const selectResourceGroup = vi.fn();
  const setSubmitAttempted = vi.fn();
  const hook = renderHook(() =>
    useAdminMasterDataActions({
      administrator,
      board,
      category,
      clearPinWhenLocked,
      editors: baseEditors as never,
      finishEditor,
      getAdminPin: () => "123456",
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
    }),
  );
  return {
    ...hook,
    clearPinWhenLocked,
    finishEditor,
    onAssignmentComplete,
    onManifestCorrected,
    onMessage,
    refreshBoard,
    refreshHistory,
    requestAdminAction,
    runBusyAction,
    setSubmitAttempted,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("admin master-data actions", () => {
  it("blocks editor saves without administrator authorization", () => {
    const { result, onMessage, requestAdminAction, setSubmitAttempted } = renderActions({
      administrator: false,
    });

    act(() => result.current.requestCurrentMasterSave());

    expect(setSubmitAttempted).toHaveBeenCalledWith(true);
    expect(requestAdminAction).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledWith(
      "Für Stammdatenänderungen wird ein Administrationskonto benötigt.",
    );
  });

  it("persists a gate with version, audit reason and pin before refreshing", async () => {
    mocks.sendCommand.mockResolvedValue({});
    const { result, clearPinWhenLocked, finishEditor, refreshBoard, refreshHistory } =
      renderActions();

    act(() => result.current.requestCurrentMasterSave());

    await waitFor(() => expect(mocks.sendCommand).toHaveBeenCalledOnce());
    expect(mocks.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 17,
        type: "UPSERT_GATE",
        payload: expect.objectContaining({
          adminPin: "123456",
          gateId: "gate-a",
          label: "Gate A",
          reason: "Synthetic master-data change",
        }),
      }),
      "synthetic-device-token",
    );
    expect(clearPinWhenLocked).toHaveBeenCalledOnce();
    expect(finishEditor).toHaveBeenCalledOnce();
    expect(refreshBoard).toHaveBeenCalledOnce();
    expect(refreshHistory).toHaveBeenCalledOnce();
  });

  it("preserves resource-group membership by omitting aircraft from its update", async () => {
    mocks.sendCommand.mockResolvedValue({});
    const { result } = renderActions({ category: "resource-groups" });

    act(() => result.current.requestCurrentMasterSave());

    await waitFor(() => expect(mocks.sendCommand).toHaveBeenCalledOnce());
    const command = mocks.sendCommand.mock.calls[0]?.[0] as { payload: Record<string, unknown> };
    expect(command).toMatchObject({
      type: "UPSERT_RESOURCE_GROUP",
      payload: {
        automaticPrecallEnabled: true,
        compatibleAircraftTypes: [],
        gateId: "gate-a",
        referenceCapacity: 4,
        shortCode: "PA",
      },
    });
    expect(command.payload).not.toHaveProperty("aircraftIds");
  });

  it("maps every product planning field into its audited command", async () => {
    mocks.sendCommand.mockResolvedValue({});
    const { result } = renderActions({ category: "products" });

    act(() => result.current.requestCurrentMasterSave());

    await waitFor(() => expect(mocks.sendCommand).toHaveBeenCalledOnce());
    expect(mocks.sendCommand.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: "UPSERT_PRODUCT",
        payload: expect.objectContaining({
          childCompanionRequired: false,
          priceCents: 2500,
          promisedFlightMinutes: 15,
          publicDescription: "Synthetic product",
          referenceCapacity: 4,
          referenceDurationMinutes: 20,
          weightClasses: [],
        }),
      }),
    );
  });

  it("keeps aircraft assignment behind the authenticated busy boundary", async () => {
    mocks.sendCommand.mockResolvedValue({});
    const { result, onAssignmentComplete, requestAdminAction, runBusyAction } = renderActions();

    act(() => result.current.requestAircraftAssignment("aircraft-a", "group-a"));

    await waitFor(() => expect(mocks.sendCommand).toHaveBeenCalledOnce());
    expect(requestAdminAction).toHaveBeenCalledOnce();
    expect(runBusyAction).toHaveBeenCalledWith("master-assignment", expect.any(Function));
    expect(mocks.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ASSIGN_AIRCRAFT_RESOURCE_GROUP",
        payload: expect.objectContaining({ aircraftId: "aircraft-a", resourceGroupId: "group-a" }),
      }),
      "synthetic-device-token",
    );
    expect(onAssignmentComplete).toHaveBeenCalledOnce();
  });

  it("keeps manifest correction audited behind the authenticated busy boundary", async () => {
    mocks.sendCommand.mockResolvedValue({});
    const { result, onManifestCorrected, requestAdminAction, runBusyAction } = renderActions();

    act(() =>
      result.current.requestManifestCorrection(
        "ticket-group-a",
        "rotation-a",
        "Synthetic correction reason",
      ),
    );

    await waitFor(() => expect(mocks.sendCommand).toHaveBeenCalledOnce());
    expect(requestAdminAction).toHaveBeenCalledOnce();
    expect(runBusyAction).toHaveBeenCalledWith("manifest-correction", expect.any(Function));
    expect(mocks.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "CORRECT_ROTATION_MANIFEST",
        payload: expect.objectContaining({
          adminPin: "123456",
          reason: "Synthetic correction reason",
          targetRotationId: "rotation-a",
          ticketGroupId: "ticket-group-a",
        }),
      }),
      "synthetic-device-token",
    );
    expect(onManifestCorrected).toHaveBeenCalledOnce();
  });

  it("deletes an existing turnaround override when all values inherit", async () => {
    mocks.sendCommand.mockResolvedValue({});
    const board = {
      ...baseBoard,
      aircraftProductTurnaroundOverrides: [
        { aircraftId: "aircraft-a", productId: "product-a", version: 3 },
      ],
    } as OperationBoard;
    const { result } = renderActions({ board });

    act(() =>
      result.current.requestTurnaroundOverrideSave("aircraft-a", "product-a", {
        boarding: null,
        buffer: null,
        deboarding: null,
      }),
    );

    await waitFor(() => expect(mocks.sendCommand).toHaveBeenCalledOnce());
    expect(mocks.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE",
        payload: expect.objectContaining({ expectedOverrideVersion: 3 }),
      }),
      "synthetic-device-token",
    );
  });

  it("creates a component-specific turnaround override from inherited values", async () => {
    mocks.sendCommand.mockResolvedValue({});
    const { result } = renderActions();

    act(() =>
      result.current.requestTurnaroundOverrideSave("aircraft-a", "product-a", {
        boarding: 4,
        buffer: null,
        deboarding: 3,
      }),
    );

    await waitFor(() => expect(mocks.sendCommand).toHaveBeenCalledOnce());
    expect(mocks.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE",
        payload: expect.objectContaining({
          expectedOverrideVersion: 0,
          plannedBoardingMinutesOverride: 4,
          plannedBufferMinutesOverride: null,
          plannedDeboardingMinutesOverride: 3,
        }),
      }),
      "synthetic-device-token",
    );
  });

  it("keeps the admin pin exclusive to clearing emergency mode", async () => {
    mocks.sendCommand.mockResolvedValue({});
    const { result } = renderActions();

    await act(() => result.current.emergency("TRIGGER_EMERGENCY", "Synthetic emergency"));
    await act(() => result.current.emergency("CLEAR_EMERGENCY", "Synthetic clear"));

    const trigger = mocks.sendCommand.mock.calls[0]?.[0] as { payload: Record<string, unknown> };
    const clear = mocks.sendCommand.mock.calls[1]?.[0] as { payload: Record<string, unknown> };
    expect(trigger.payload).not.toHaveProperty("adminPin");
    expect(clear.payload).toMatchObject({ adminPin: "123456" });
  });
});
