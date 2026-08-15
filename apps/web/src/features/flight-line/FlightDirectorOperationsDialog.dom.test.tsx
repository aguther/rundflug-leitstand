// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FlightDirectorOperationsDialog,
  type FlightDirectorOperationsDialogProps,
} from "./FlightDirectorOperationsDialog";

vi.mock("../operations/OperationalPlanPanel", () => ({
  OperationalPlanPanel: ({ eventId }: { eventId: string }) => (
    <div data-testid="operational-plan">Betriebsplan {eventId}</div>
  ),
}));

afterEach(() => cleanup());

function resourceGroup(
  overrides: Partial<OperationBoard["resourceGroups"][number]> = {},
): OperationBoard["resourceGroups"][number] {
  return {
    activeAircraftIds: ["aircraft-one"],
    id: "resource-one",
    name: "Oldtimer",
    operationalNote: "",
    shortCode: "OT",
    status: "ACTIVE",
    ...overrides,
  } as OperationBoard["resourceGroups"][number];
}

function createProps(
  overrides: Partial<FlightDirectorOperationsDialogProps> = {},
): FlightDirectorOperationsDialogProps {
  return {
    aircraft: [],
    busy: false,
    emergencyMode: false,
    eventId: "event-one",
    eventInterrupted: false,
    eventNotice: "",
    eventTimeZone: "Europe/Berlin",
    onCancelPlannedOperation: vi.fn(),
    onClose: vi.fn(),
    onConfirmPlannedOperation: vi.fn(),
    onDisableRecurringRule: vi.fn(),
    onPublishEventNotice: vi.fn().mockResolvedValue(true),
    onPublishResourceNotice: vi.fn().mockResolvedValue(true),
    onSetEventInterruption: vi.fn(),
    onSetResourceGroupStatus: vi.fn(),
    onTriggerEmergency: vi.fn(),
    onUpsertPlannedOperation: vi.fn(),
    onUpsertRecurringRule: vi.fn(),
    open: true,
    pilots: [],
    plannedOperations: [],
    recurringOperationalRules: [],
    resourceGroups: [resourceGroup()],
    rotations: [],
    ...overrides,
  };
}

describe("Flight Director operations dialog", () => {
  it("publishes and removes the event notice and invokes operational controls", async () => {
    const user = userEvent.setup();
    const props = createProps();
    const { rerender } = render(<FlightDirectorOperationsDialog {...props} />);

    expect(screen.getByRole("dialog", { name: "Betrieb steuern" })).toBeTruthy();
    expect(screen.getByText("Kein Hinweis veröffentlicht")).toBeTruthy();
    expect(screen.getByText("Kein Not-Halt aktiv")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Hinweis veröffentlichen" }));
    expect(screen.getByRole("dialog", { name: "Veranstaltungsweiter Hinweis" })).toBeTruthy();
    const notice = screen.getByRole("textbox", { name: /^Hinweis/ });
    await user.type(notice, "  Wetterpause  ");
    await user.click(screen.getByRole("button", { name: "Hinweis veröffentlichen" }));
    await waitFor(() => expect(props.onPublishEventNotice).toHaveBeenCalledWith("Wetterpause"));
    expect(screen.getByRole("dialog", { name: "Betrieb steuern" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Betrieb unterbrechen" }));
    await user.click(screen.getByRole("button", { name: "Not-Halt auslösen" }));
    expect(props.onSetEventInterruption).toHaveBeenCalledWith(true);
    expect(props.onTriggerEmergency).toHaveBeenCalledOnce();

    rerender(
      <FlightDirectorOperationsDialog
        {...props}
        emergencyMode
        eventInterrupted
        eventNotice="Bestehender Hinweis"
      />,
    );
    expect(screen.getByText("Hinweis veröffentlicht")).toBeTruthy();
    expect(screen.getByText("Not-Halt aktiv")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Betrieb fortsetzen" }));
    expect(props.onSetEventInterruption).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole("button", { name: "Hinweis bearbeiten" }));
    expect((screen.getByRole("textbox", { name: /^Hinweis/ }) as HTMLTextAreaElement).value).toBe(
      "Bestehender Hinweis",
    );
    await user.click(screen.getByRole("button", { name: "Löschen" }));
    await waitFor(() => expect(props.onPublishEventNotice).toHaveBeenLastCalledWith(""));
    await user.click(screen.getByRole("button", { name: "Schließen" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("controls resource groups and edits their scoped notices", async () => {
    const user = userEvent.setup();
    const props = createProps();
    const { rerender } = render(<FlightDirectorOperationsDialog {...props} />);

    await user.click(screen.getByRole("tab", { name: "Ressourcengruppen" }));
    expect(screen.getByText("Oldtimer")).toBeTruthy();
    expect(screen.getByText("1 Flugzeuge")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Aktiv" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await user.click(screen.getByRole("button", { name: "Pause" }));
    await user.click(screen.getByRole("button", { name: "Beendet" }));
    expect(props.onSetResourceGroupStatus).toHaveBeenNthCalledWith(1, "resource-one", "PAUSED");
    expect(props.onSetResourceGroupStatus).toHaveBeenNthCalledWith(2, "resource-one", "ENDED");

    await user.click(screen.getByRole("button", { name: "Hinweis veröffentlichen" }));
    expect(screen.getByRole("dialog", { name: "Hinweis für Oldtimer" })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: /^Hinweis/ }), "  Nur Halle 2  ");
    await user.click(screen.getByRole("button", { name: "Hinweis veröffentlichen" }));
    await waitFor(() =>
      expect(props.onPublishResourceNotice).toHaveBeenCalledWith("resource-one", "Nur Halle 2"),
    );

    rerender(
      <FlightDirectorOperationsDialog
        {...props}
        resourceGroups={[resourceGroup({ operationalNote: "Bestehender Gruppenhinweis" })]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Hinweis bearbeiten" }));
    expect((screen.getByRole("textbox", { name: /^Hinweis/ }) as HTMLTextAreaElement).value).toBe(
      "Bestehender Gruppenhinweis",
    );
    await user.click(screen.getByRole("button", { name: "Zurück" }));
    expect(
      screen.getByRole("tab", { name: "Ressourcengruppen" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("keeps a rejected notice open and resets the active tab after reopening", async () => {
    const user = userEvent.setup();
    const onPublishEventNotice = vi.fn().mockResolvedValue(false);
    const props = createProps({ onPublishEventNotice });
    const { rerender } = render(<FlightDirectorOperationsDialog {...props} />);

    await user.click(screen.getByRole("button", { name: "Hinweis veröffentlichen" }));
    const notice = screen.getByRole("textbox", { name: /^Hinweis/ });
    expect(
      (screen.getByRole("button", { name: "Hinweis veröffentlichen" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.type(notice, "Bleibt offen");
    await user.click(screen.getByRole("button", { name: "Hinweis veröffentlichen" }));
    await waitFor(() => expect(onPublishEventNotice).toHaveBeenCalledWith("Bleibt offen"));
    expect(screen.getByRole("textbox", { name: /^Hinweis/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Zurück" }));

    await user.click(screen.getByRole("tab", { name: "Betriebsplan" }));
    expect(screen.getByTestId("operational-plan").textContent).toContain("event-one");
    rerender(<FlightDirectorOperationsDialog {...props} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<FlightDirectorOperationsDialog {...props} open />);
    expect(screen.getByRole("tab", { name: "Betrieb" }).getAttribute("aria-selected")).toBe("true");
  });
});
