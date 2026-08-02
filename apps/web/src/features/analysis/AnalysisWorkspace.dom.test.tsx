// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisWorkspace } from "./AnalysisWorkspace";

const api = vi.hoisted(() => ({
  listAnalysisArchives: vi.fn(),
  createAnalysisArchive: vi.fn(),
  downloadAnalysisArchive: vi.fn(),
  deleteAnalysisArchive: vi.fn(),
  downloadAnalysisSnapshot: vi.fn(),
}));

vi.mock("../../api", () => api);
vi.mock("../../operation-workspace", () => ({
  ADMIN_DEVICE_ID: "admin-device",
  deviceTokenFor: () => "synthetic-token",
}));

const archive = {
  id: "archive-synthetic",
  eventId: "event-synthetic",
  eventVersion: 7,
  privacyProfile: "SUPPORT_SAFE" as const,
  formatVersion: 1 as const,
  status: "READY" as const,
  requestedAt: "2026-08-02T10:00:00.000Z",
  startedAt: "2026-08-02T10:00:01.000Z",
  completedAt: "2026-08-02T10:00:02.000Z",
  expiresAt: "2026-09-01T10:00:00.000Z",
  sizeBytes: 1024,
  failureCode: null,
};

function board(status: "ACTIVE" | "CLOSED" | "ARCHIVED") {
  return {
    event: {
      eventId: "event-synthetic",
      eventDate: "2026-08-02",
      timeZone: "Europe/Berlin",
      status,
      version: 7,
    },
  } as never;
}

describe("analysis workspace archive lifecycle", () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.listAnalysisArchives.mockReset().mockResolvedValue([archive]);
    api.createAnalysisArchive.mockReset().mockResolvedValue(archive);
    api.downloadAnalysisArchive.mockReset().mockResolvedValue(undefined);
    api.deleteAnalysisArchive.mockReset().mockResolvedValue({ ...archive, status: "DELETED" });
  });

  it("keeps archive actions in a bounded stable table", async () => {
    render(
      <AnalysisWorkspace
        backendConfirmed
        board={board("CLOSED")}
        onRefresh={() => undefined}
        simulator={<div>Simulator</div>}
      />,
    );

    expect(await screen.findByText("Bereit")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /Tagespaket Version 7 herunterladen/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(document.querySelectorAll(".analysis-archives-table-scroll")).toHaveLength(1);
    expect(
      (screen.getByRole("button", { name: "Tagespaket erstellen" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("blocks creation before close and confirms deletion", async () => {
    const user = userEvent.setup();
    const rendered = render(
      <AnalysisWorkspace
        backendConfirmed
        board={board("ACTIVE")}
        onRefresh={() => undefined}
        simulator={<div>Simulator</div>}
      />,
    );
    expect(await screen.findByText("Bereit")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Tagespaket erstellen" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    rendered.rerender(
      <AnalysisWorkspace
        backendConfirmed
        board={board("CLOSED")}
        onRefresh={() => undefined}
        simulator={<div>Simulator</div>}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Tagespaket Version 7 löschen/ }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Tagespaket löschen" }));
    await waitFor(() => expect(api.deleteAnalysisArchive).toHaveBeenCalledOnce());
  });
});
