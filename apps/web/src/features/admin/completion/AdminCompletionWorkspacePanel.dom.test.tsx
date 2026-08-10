// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminCompletionWorkspacePanel } from "./AdminCompletionWorkspacePanel";

vi.mock("./AdminCompletionSummaryPanel", () => ({ AdminCompletionSummaryPanel: () => null }));
vi.mock("./CompletionWorkspace", () => ({
  CompletionWorkspace: ({ history }: { history: ReactNode }) => <div>{history}</div>,
}));
vi.mock("./ManifestCorrectionPanel", () => ({ ManifestCorrectionPanel: () => null }));
vi.mock("./CompletionHistoryPanel", () => ({
  CompletionHistoryPanel: ({
    onNextPage,
    onPreviousPage,
  }: {
    onNextPage: () => void;
    onPreviousPage: () => void;
  }) => (
    <div>
      <button onClick={onPreviousPage} type="button">
        Previous history
      </button>
      <button onClick={onNextPage} type="button">
        Next history
      </button>
    </div>
  ),
}));

afterEach(cleanup);

describe("admin completion workspace panel", () => {
  it("serializes forward and backward history pagination with bounded offsets", () => {
    const refreshDetailedHistory = vi.fn().mockResolvedValue(undefined);
    const onRunBusyAction = vi.fn((_key: string, action: () => Promise<void>) => action());
    render(
      <AdminCompletionWorkspacePanel
        administrator
        board={{} as OperationBoard}
        busyActionKey={null}
        history={
          {
            applyFilters: vi.fn(),
            auditHistory: { entries: [] },
            changeFilter: vi.fn(),
            changeView: vi.fn(),
            filters: {},
            forecastHistory: { entries: [] },
            offset: 25,
            operationalHistory: { entries: [] },
            refreshDetailedHistory,
            resetFilters: vi.fn(),
            view: "OPERATIONS",
          } as never
        }
        manifestCorrectionResetKey={0}
        onMessage={vi.fn()}
        onRequestManifestCorrection={vi.fn()}
        onRunBusyAction={onRunBusyAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next history" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous history" }));

    expect(onRunBusyAction).toHaveBeenNthCalledWith(1, "history-next", expect.any(Function));
    expect(onRunBusyAction).toHaveBeenNthCalledWith(2, "history-previous", expect.any(Function));
    expect(refreshDetailedHistory).toHaveBeenNthCalledWith(1, 75);
    expect(refreshDetailedHistory).toHaveBeenNthCalledWith(2, 0);
  });
});
