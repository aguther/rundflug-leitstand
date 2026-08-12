// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMasterDataTemplateImport } from "./useMasterDataTemplateImport";

const mocks = vi.hoisted(() => ({
  importMasterDataTemplate: vi.fn(),
  validateMasterDataTemplate: vi.fn(),
}));

vi.mock("../../../api", () => mocks);
vi.mock("../../operations/operation-identity", () => ({
  useAdminOperationIdentity: () => ({
    eventId: "synthetic-event",
    deviceId: "synthetic-admin-device",
    deviceToken: "synthetic-device-token",
  }),
}));

const template = {
  format: "rundflug-master-data-template",
  formatVersion: 1,
  exportedAt: "2026-08-10T08:00:00.000Z",
  source: { name: "Synthetic event", version: 3 },
  eventParameters: {
    noShowAfterMinutes: 10,
    maxTicketDeferrals: 2,
    notificationLeadMinutes: 15,
    automaticPrecallEnabled: true,
    precallLeadMinutes: 15,
    maximumGateWaitMinutes: 20,
    precallMinimumQuality: "CHANGING",
    precallGateCooldownMinutes: 2,
    referenceWeightsKg: { child: 35, normal: 80, heavy: 110 },
    plannedBoardingMinutes: 8,
    plannedDeboardingMinutes: 5,
    plannedBufferMinutes: 3,
    departedVisibilitySeconds: 15,
  },
  gates: [],
  resourceGroups: [],
  aircraft: [],
  assignments: [],
  pilots: [],
  products: [],
};

const validation = {
  valid: true,
  targetEligible: true,
  counts: { gates: 0, resourceGroups: 0, aircraft: 0, assignments: 0, pilots: 0, products: 0 },
  errors: [],
  warnings: [],
};

function renderImport() {
  const callbacks = {
    onMessage: vi.fn(),
    onRefreshBoard: vi.fn(async () => undefined),
    onRefreshEvents: vi.fn(async () => undefined),
    onRefreshHistory: vi.fn(async () => undefined),
  };
  const hook = renderHook(() =>
    useMasterDataTemplateImport({
      board: { event: { version: 9 } } as OperationBoard,
      ...callbacks,
    }),
  );
  return { ...hook, ...callbacks };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("master data template import state", () => {
  it("validates a local template before importing it atomically", async () => {
    mocks.validateMasterDataTemplate.mockResolvedValue(validation);
    mocks.importMasterDataTemplate.mockResolvedValue({ counts: validation.counts });
    const state = renderImport();

    act(() => state.result.current.openDialog());
    await act(() =>
      state.result.current.readFile(
        new File([JSON.stringify(template)], "synthetic-template.json", {
          type: "application/json",
        }),
      ),
    );

    expect(state.result.current.fileName).toBe("synthetic-template.json");
    expect(state.result.current.validation).toEqual(validation);
    await act(() => state.result.current.applyTemplate());

    expect(mocks.importMasterDataTemplate).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ expectedVersion: 9, template: expect.objectContaining(template) }),
    );
    expect(state.result.current.open).toBe(false);
    expect(state.onRefreshBoard).toHaveBeenCalledOnce();
    expect(state.onRefreshEvents).toHaveBeenCalledOnce();
    expect(state.onRefreshHistory).toHaveBeenCalledOnce();
  });

  it("rejects oversized files without server validation", async () => {
    const { result } = renderImport();

    await act(() =>
      result.current.readFile(
        new File([new Uint8Array(1_048_577)], "oversized-template.json", {
          type: "application/json",
        }),
      ),
    );

    expect(result.current.error).toBe("Die Vorlagendatei darf höchstens 1 MiB groß sein.");
    expect(mocks.validateMasterDataTemplate).not.toHaveBeenCalled();
  });

  it("retains validation and import errors for the dialog", async () => {
    mocks.validateMasterDataTemplate.mockRejectedValue(new Error("Synthetic validation failure"));
    const { result } = renderImport();

    await act(() =>
      result.current.readFile(
        new File([JSON.stringify(template)], "synthetic-template.json", {
          type: "application/json",
        }),
      ),
    );

    await waitFor(() => expect(result.current.error).toBe("Synthetic validation failure"));
    expect(result.current.busy).toBe(false);
  });
});
