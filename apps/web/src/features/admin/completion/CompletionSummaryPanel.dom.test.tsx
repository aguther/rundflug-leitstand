// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompletionSummaryPanel } from "./CompletionSummaryPanel";

const board = {
  event: {
    operationsStartAt: "2026-08-10T08:00:00.000Z",
    operationsEndAt: null,
    timeZone: "Europe/Berlin",
  },
  metrics: {
    completedRotations: 12,
    openTickets: 4,
    averageRotationMinutes: 31,
    informationalRevenueCents: 123450,
  },
} as unknown as OperationBoard;

afterEach(cleanup);

describe("completion summary panel", () => {
  it("presents confirmed event and board metrics without inventing an end time", () => {
    render(
      <CompletionSummaryPanel
        board={board}
        busyActionKey={null}
        onExportDailyCsv={vi.fn()}
        onExportDailyPdf={vi.fn()}
        onExportPerformance={vi.fn()}
        onExportRawData={vi.fn()}
      />,
    );

    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("31 Min.")).toBeTruthy();
    expect(screen.getByText("Nicht gesetzt")).toBeTruthy();
    expect(screen.getByText(/1.234,50/)).toBeTruthy();
  });

  it("routes primary and secondary exports independently", () => {
    const onExportDailyCsv = vi.fn();
    const onExportDailyPdf = vi.fn();
    const onExportPerformance = vi.fn();
    const onExportRawData = vi.fn();
    render(
      <CompletionSummaryPanel
        board={board}
        busyActionKey={null}
        onExportDailyCsv={onExportDailyCsv}
        onExportDailyPdf={onExportDailyPdf}
        onExportPerformance={onExportPerformance}
        onExportRawData={onExportRawData}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "PDF-Tagesbericht" }));
    fireEvent.click(screen.getByRole("button", { name: "CSV-Tagesbericht" }));
    fireEvent.click(screen.getByRole("button", { name: "Ticket-Rohdaten CSV" }));
    fireEvent.click(screen.getByRole("button", { name: "Leistungsprofil JSON" }));

    expect(onExportDailyPdf).toHaveBeenCalledOnce();
    expect(onExportDailyCsv).toHaveBeenCalledOnce();
    expect(onExportRawData).toHaveBeenCalledOnce();
    expect(onExportPerformance).toHaveBeenCalledOnce();
  });

  it("exposes the active export as busy", () => {
    render(
      <CompletionSummaryPanel
        board={board}
        busyActionKey="export-daily-pdf"
        onExportDailyCsv={vi.fn()}
        onExportDailyPdf={vi.fn()}
        onExportPerformance={vi.fn()}
        onExportRawData={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /PDF-Tagesbericht/ }).getAttribute("aria-busy")).toBe(
      "true",
    );
  });
});
