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
  analysisSnapshotRequiresRefresh: vi.fn(),
}));

vi.mock("../../api", () => api);
vi.mock("../operations/operation-identity", () => ({
  useAdminOperationIdentity: () => ({
    eventId: "event-synthetic",
    deviceId: "admin-device",
    deviceToken: "synthetic-token",
  }),
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
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    api.listAnalysisArchives.mockReset().mockResolvedValue([archive]);
    api.createAnalysisArchive.mockReset().mockResolvedValue(archive);
    api.downloadAnalysisArchive.mockReset().mockResolvedValue(undefined);
    api.deleteAnalysisArchive.mockReset().mockResolvedValue({ ...archive, status: "DELETED" });
    api.downloadAnalysisSnapshot.mockReset().mockResolvedValue("snapshot.json");
    api.analysisSnapshotRequiresRefresh.mockReset().mockReturnValue(false);
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

  it("V1120-DIA-010 reports a successful snapshot download without moving the action", async () => {
    const user = userEvent.setup();
    render(
      <AnalysisWorkspace
        backendConfirmed
        board={board("ACTIVE")}
        onRefresh={() => undefined}
        simulator={<div>Simulator</div>}
      />,
    );
    const action = screen.getByRole("button", { name: "Aktuelle Momentaufnahme exportieren" });
    const actionSlot = action.closest(".analysis-snapshot-action-slot");

    await user.click(action);

    expect(await screen.findByText("Momentaufnahme wurde heruntergeladen.")).toBeTruthy();
    expect(api.downloadAnalysisSnapshot).toHaveBeenCalledOnce();
    expect(action.closest(".analysis-snapshot-action-slot")).toBe(actionSlot);
  });

  it("V1120-QA-010 offers refresh only for a typed stale snapshot error", async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    api.downloadAnalysisSnapshot.mockRejectedValue(new Error("opaque failure"));
    api.analysisSnapshotRequiresRefresh.mockReturnValue(true);
    render(
      <AnalysisWorkspace
        backendConfirmed
        board={board("ACTIVE")}
        onRefresh={onRefresh}
        simulator={<div>Simulator</div>}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Aktuelle Momentaufnahme exportieren" }));

    expect(
      await screen.findByText(
        "Der Betriebsstand hat sich geändert. Ansicht aktualisieren und Export erneut starten.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Aktualisieren" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(api.analysisSnapshotRequiresRefresh).toHaveBeenCalledWith(expect.any(Error));
  });

  it("V1120-QA-010 keeps retry guidance for non-stale snapshot failures", async () => {
    const user = userEvent.setup();
    api.downloadAnalysisSnapshot.mockRejectedValue(new Error("Version appears in irrelevant text"));
    render(
      <AnalysisWorkspace
        backendConfirmed
        board={board("ACTIVE")}
        onRefresh={() => undefined}
        simulator={<div>Simulator</div>}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Aktuelle Momentaufnahme exportieren" }));

    expect(
      await screen.findByText(
        "Die Momentaufnahme konnte nicht erstellt werden. Bitte erneut versuchen.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Aktualisieren" })).toBeNull();
  });
});
