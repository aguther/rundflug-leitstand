// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMasterDataDeletionBlockers,
  useAdminMasterDataDeletion,
} from "./useAdminMasterDataDeletion";

const sendCommand = vi.hoisted(() => vi.fn());

vi.mock("../../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api")>()),
  sendCommand,
}));
vi.mock("../../operations/operation-identity", () => ({
  useAdminOperationIdentity: () => ({
    eventId: "synthetic-event",
    deviceId: "synthetic-admin-device",
    deviceToken: "synthetic-device-token",
  }),
}));

const board = {
  event: { status: "PREPARATION", version: 17 },
  gates: [{ id: "gate-a" }],
  resourceGroups: [{ id: "group-a", gateId: "gate-a" }],
  products: [{ id: "product-a", code: "PAN", gateId: "gate-a", resourceGroupId: "group-a" }],
  aircraft: [{ id: "aircraft-a", resourceGroupId: "group-a", currentPilotId: "pilot-a" }],
  pilots: [{ id: "pilot-a", currentRotationId: "rotation-a" }],
  rotations: [
    {
      id: "rotation-a",
      gateId: "gate-a",
      productCode: "PAN",
      aircraftId: "aircraft-a",
    },
  ],
} as unknown as OperationBoard;

function renderDeletion(overrides: Partial<Parameters<typeof useAdminMasterDataDeletion>[0]> = {}) {
  const callbacks = {
    onClearAdminPin: vi.fn(),
    onEditorOpenChange: vi.fn(),
    onFinishEditor: vi.fn(),
    onMessage: vi.fn(),
    onRefreshBoard: vi.fn().mockResolvedValue(undefined),
    onRefreshHistory: vi.fn().mockResolvedValue(undefined),
  };
  const view = renderHook(() =>
    useAdminMasterDataDeletion({
      adminModeUnlocked: true,
      board: {
        ...board,
        aircraft: [],
        pilots: [],
        products: [],
        resourceGroups: [],
        rotations: [],
      },
      getAdminPin: () => "1234",
      ...callbacks,
      ...overrides,
    }),
  );
  return { callbacks, view };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin master-data deletion", () => {
  it("describes every relationship that blocks a destructive change", () => {
    expect(getMasterDataDeletionBlockers(board, "GATE", "gate-a")).toEqual([
      "1 Ressourcengruppe(n)",
      "1 Produkt(e)",
      "1 Umlauf/Umläufe",
    ]);
    expect(getMasterDataDeletionBlockers(board, "RESOURCE_GROUP", "group-a")).toEqual([
      "1 Produkt(e)",
      "1 Flugzeugzuordnung(en)",
    ]);
    expect(getMasterDataDeletionBlockers(board, "PRODUCT", "product-a")).toEqual([
      "1 Umlauf/Umläufe",
    ]);
    expect(getMasterDataDeletionBlockers(board, "AIRCRAFT", "aircraft-a")).toEqual([
      "1 Flugzeugzuordnung",
      "1 Umlauf/Umläufe",
    ]);
    expect(getMasterDataDeletionBlockers(board, "PILOT", "pilot-a")).toEqual([
      "1 aktiver Umlauf",
      "1 Flugzeugbindung(en)",
    ]);
  });

  it("closes the editor for confirmation and restores it when cancelled", () => {
    const { callbacks, view } = renderDeletion({ adminModeUnlocked: false });

    act(() => view.result.current.requestDeletion("PILOT", "pilot-a", "Pilot A"));

    expect(callbacks.onClearAdminPin).toHaveBeenCalledOnce();
    expect(callbacks.onEditorOpenChange).toHaveBeenCalledWith(false);
    expect(view.result.current.pendingDeletion).toMatchObject({
      entityId: "pilot-a",
      entityType: "PILOT",
      label: "Pilot A",
    });

    act(() => view.result.current.cancelDeletion());
    expect(view.result.current.pendingDeletion).toBeNull();
    expect(callbacks.onEditorOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("persists an eligible deletion before refreshing board and history", async () => {
    sendCommand.mockResolvedValue({});
    const { callbacks, view } = renderDeletion();
    act(() => view.result.current.requestDeletion("PILOT", "pilot-a", "Pilot A"));

    await act(() => view.result.current.confirmDeletion());

    expect(sendCommand).toHaveBeenCalledOnce();
    expect(sendCommand.mock.calls[0]?.[0]).toMatchObject({
      expectedVersion: 17,
      type: "DELETE_MASTER_DATA",
      payload: {
        adminPin: "1234",
        entityId: "pilot-a",
        entityType: "PILOT",
        reason: "Administrative Stammdatenlöschung",
      },
    });
    expect(callbacks.onMessage).toHaveBeenCalledWith(
      "Pilot A wurde gelöscht und die Löschung protokolliert.",
    );
    expect(callbacks.onFinishEditor).toHaveBeenCalledOnce();
    expect(callbacks.onRefreshBoard).toHaveBeenCalledOnce();
    expect(callbacks.onRefreshHistory).toHaveBeenCalledOnce();
    expect(view.result.current.pendingDeletion).toBeNull();
  });

  it("rejects deletion locally while relationships still block it", async () => {
    const { view } = renderDeletion({ board });
    act(() => view.result.current.requestDeletion("PRODUCT", "product-a", "Panorama"));

    await act(() => view.result.current.confirmDeletion());

    expect(sendCommand).not.toHaveBeenCalled();
    expect(view.result.current.pendingDeletion?.blockers).toEqual(["1 Umlauf/Umläufe"]);
  });
});
