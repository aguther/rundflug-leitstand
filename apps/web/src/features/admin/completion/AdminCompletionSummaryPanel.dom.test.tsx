// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminCompletionSummaryPanel } from "./AdminCompletionSummaryPanel";

const mocks = vi.hoisted(() => ({
  downloadDailyPdf: vi.fn(),
  downloadDailyReport: vi.fn(),
  downloadPerformanceProfile: vi.fn(),
  downloadTicketRawData: vi.fn(),
}));

vi.mock("../../../api", () => mocks);
vi.mock("./CompletionSummaryPanel", () => ({
  CompletionSummaryPanel: ({
    onExportDailyCsv,
    onExportDailyPdf,
    onExportPerformance,
    onExportRawData,
  }: {
    onExportDailyCsv: () => void;
    onExportDailyPdf: () => void;
    onExportPerformance: () => void;
    onExportRawData: () => void;
  }) => (
    <div>
      <button onClick={onExportDailyCsv} type="button">
        CSV
      </button>
      <button onClick={onExportDailyPdf} type="button">
        PDF
      </button>
      <button onClick={onExportRawData} type="button">
        Raw data
      </button>
      <button onClick={onExportPerformance} type="button">
        Performance
      </button>
    </div>
  ),
}));

function renderSummary() {
  const onMessage = vi.fn();
  const onRunBusyAction = vi.fn((_key: string, action: () => Promise<void>) => action());
  render(
    <AdminCompletionSummaryPanel
      board={{} as OperationBoard}
      busyActionKey={null}
      onMessage={onMessage}
      onRunBusyAction={onRunBusyAction}
    />,
  );
  return { onMessage, onRunBusyAction };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin completion summary exports", () => {
  it("serializes all report downloads through their existing busy keys", async () => {
    for (const download of Object.values(mocks)) download.mockResolvedValue(undefined);
    const callbacks = renderSummary();

    for (const [index, label] of ["CSV", "PDF", "Raw data", "Performance"].entries()) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(callbacks.onRunBusyAction).toHaveBeenCalledTimes(index + 1));
    }

    expect(callbacks.onRunBusyAction.mock.calls.map(([key]) => key)).toEqual([
      "export-daily-csv",
      "export-daily-pdf",
      "export-raw-data",
      "export-performance",
    ]);
    await waitFor(() => expect(mocks.downloadPerformanceProfile).toHaveBeenCalledOnce());
    expect(callbacks.onMessage).toHaveBeenCalledWith("Tagesbericht wurde erzeugt.");
    expect(callbacks.onMessage).toHaveBeenCalledWith("PDF-Tagesbericht wurde erzeugt.");
    expect(callbacks.onMessage).toHaveBeenCalledWith("Ticket-Rohdaten wurden exportiert.");
    expect(callbacks.onMessage).toHaveBeenCalledWith(
      "Kontextbezogenes Leistungsprofil wurde exportiert.",
    );
  });

  it("reports download failures without escaping the action boundary", async () => {
    mocks.downloadDailyPdf.mockRejectedValue(new Error("Synthetic PDF failure"));
    const { onMessage } = renderSummary();

    fireEvent.click(screen.getByRole("button", { name: "PDF" }));

    await waitFor(() => expect(onMessage).toHaveBeenCalledWith("Synthetic PDF failure"));
  });
});
