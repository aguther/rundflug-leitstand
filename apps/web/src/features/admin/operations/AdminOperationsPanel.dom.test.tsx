// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SetupStep } from "../../../admin-ux";
import { AdminOperationsPanel } from "./AdminOperationsPanel";

const setupSteps: SetupStep[] = [
  { id: "event", label: "Veranstaltung", complete: true },
  { id: "gates", label: "Gates", complete: false },
  { id: "resource-groups", label: "Ressourcengruppen", complete: true },
  { id: "aircraft", label: "Flugzeuge", complete: true },
  { id: "pilots", label: "Pilotencodes", complete: true },
  { id: "products", label: "Produkte", complete: true },
];

function board(status: OperationBoard["event"]["status"], emergencyMode = false): OperationBoard {
  return {
    event: {
      eventId: "synthetic-event",
      version: 3,
      name: "Synthetic event",
      eventDate: "2026-07-31",
      aerodrome: "EDXX",
      timeZone: "Europe/Berlin",
      status,
      emergencyMode,
    },
    metrics: { activeRotations: 2, openTickets: 4, completedRotations: 7 },
    products: [{ saleEnabled: true }],
  } as OperationBoard;
}

const baseProps = {
  administrator: true,
  busyActionKey: null,
  completedSetupSteps: 5,
  onEmergency: vi.fn(async () => true),
  onOpenSetupStep: vi.fn(),
  onRequestAdminAction: vi.fn((action: () => Promise<void>) => action()),
  onSetEventLifecycle: vi.fn(),
  setupComplete: false,
  setupSteps,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin operations panel", () => {
  it("keeps release blocked and links to incomplete setup steps", () => {
    const onOpenSetupStep = vi.fn();
    render(
      <AdminOperationsPanel
        {...baseProps}
        board={board("PREPARATION")}
        onOpenSetupStep={onOpenSetupStep}
      />,
    );

    expect(screen.getByText("5/6 erledigt")).toBeTruthy();
    expect(document.querySelector(".event-release-v15")).toBeTruthy();
    expect(document.querySelector(".admin-emergency-section")).toBeTruthy();
    expect(document.querySelector(".operations-emergency-action")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Betrieb freigeben/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Gates fehlt" }));
    expect(onOpenSetupStep).toHaveBeenCalledWith(setupSteps[1]);
  });

  it("routes release and end-of-operations through administrator authorization", async () => {
    const onRequestAdminAction = vi.fn((action: () => Promise<void>) => action());
    const onSetEventLifecycle = vi.fn();
    const { rerender } = render(
      <AdminOperationsPanel
        {...baseProps}
        board={board("PREPARATION")}
        completedSetupSteps={6}
        onRequestAdminAction={onRequestAdminAction}
        onSetEventLifecycle={onSetEventLifecycle}
        setupComplete
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Betrieb freigeben/ }));
    await waitFor(() => expect(onSetEventLifecycle).toHaveBeenCalledWith("ACTIVE"));

    rerender(
      <AdminOperationsPanel
        {...baseProps}
        board={board("ACTIVE")}
        onRequestAdminAction={onRequestAdminAction}
        onSetEventLifecycle={onSetEventLifecycle}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Betrieb beenden" }));
    fireEvent.click(screen.getByRole("button", { name: "Betrieb jetzt beenden" }));
    await waitFor(() => expect(onSetEventLifecycle).toHaveBeenCalledWith("CLOSED"));
    expect(onRequestAdminAction).toHaveBeenCalledTimes(2);
  });

  it("requires an auditable reason and clears it after emergency activation", async () => {
    const onEmergency = vi.fn(async () => true);
    render(
      <AdminOperationsPanel {...baseProps} board={board("ACTIVE")} onEmergency={onEmergency} />,
    );

    const trigger = screen.getByRole("button", { name: "Not-Halt auslösen" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Begründung für den Notfallmodus"), {
      target: { value: "  Synthetic emergency  " },
    });
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Not-Halt auslösen" }),
    );

    await waitFor(() =>
      expect(onEmergency).toHaveBeenCalledWith("TRIGGER_EMERGENCY", "Synthetic emergency"),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Begründung für den Notfallmodus") as HTMLInputElement).value,
      ).toBe(""),
    );
  });

  it("requires administrator authorization when clearing emergency mode", async () => {
    const onRequestAdminAction = vi.fn((action: () => Promise<void>) => action());
    const onEmergency = vi.fn(async () => true);
    render(
      <AdminOperationsPanel
        {...baseProps}
        board={board("ACTIVE", true)}
        onEmergency={onEmergency}
        onRequestAdminAction={onRequestAdminAction}
      />,
    );

    fireEvent.change(screen.getByLabelText("Begründung für den Notfallmodus"), {
      target: { value: "Emergency resolved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Notfallmodus aufheben" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Notfallmodus aufheben",
      }),
    );

    await waitFor(() => expect(onRequestAdminAction).toHaveBeenCalledOnce());
    expect(onEmergency).toHaveBeenCalledWith("CLEAR_EMERGENCY", "Emergency resolved");
  });
});
