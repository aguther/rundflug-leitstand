// @vitest-environment jsdom

import type { EventCatalogEntry } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventCatalogDialog, type EventCatalogDialogProps } from "./EventCatalogDialog";

const events = [
  {
    eventId: "demo-2026",
    name: "Demo flight day",
    eventDate: "2026-08-10",
    status: "ACTIVE",
    aerodrome: "EDXX",
    timeZone: "Europe/Berlin",
    version: 4,
  },
  {
    eventId: "demo-2027",
    name: "Next flight day",
    eventDate: "2027-08-10",
    status: "PREPARATION",
    aerodrome: "EDYY",
    timeZone: "Europe/Berlin",
    version: 1,
  },
] as EventCatalogEntry[];

function properties(overrides: Partial<EventCatalogDialogProps> = {}): EventCatalogDialogProps {
  return {
    busyActionKey: null,
    canExport: true,
    canManage: true,
    creation: {
      aerodrome: "EDXX",
      date: "2027-08-10",
      disabled: false,
      error: null,
      id: "demo-2027",
      name: "Next flight day",
      restartMode: "EMPTY",
    },
    currentEventId: "demo-2026",
    currentEventName: "Demo flight day",
    currentStep: "products",
    events,
    onClose: vi.fn(),
    onCreateSubmit: vi.fn(),
    onDelete: vi.fn(),
    onExport: vi.fn(),
    onImport: vi.fn(),
    onOpenCreate: vi.fn(),
    onSearchChange: vi.fn(),
    onSetCreationAerodrome: vi.fn(),
    onSetCreationDate: vi.fn(),
    onSetCreationId: vi.fn(),
    onSetCreationName: vi.fn(),
    onSetRestartMode: vi.fn(),
    onShowCatalog: vi.fn(),
    onSort: vi.fn(),
    search: "",
    sort: { key: "eventDate", direction: "asc" },
    view: "catalog",
    ...overrides,
  };
}

afterEach(cleanup);

describe("event catalog dialog", () => {
  it("presents the filtered catalog and preserves the selected setup step", () => {
    const props = properties();
    render(<EventCatalogDialog {...props} />);

    expect(screen.getByRole("dialog", { name: "Veranstaltungen verwalten" })).toBeTruthy();
    expect(screen.getByText("demo-2026")).toBeTruthy();
    expect(screen.getByText("demo-2027")).toBeTruthy();
    const currentRow = screen.getByRole("link", { name: "Demo flight day" }).closest("tr");
    expect(currentRow?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("link", { name: "Next flight day" }).getAttribute("href")).toContain(
      "step=products",
    );

    fireEvent.change(screen.getByLabelText("Veranstaltungen durchsuchen"), {
      target: { value: "next" },
    });
    expect(props.onSearchChange).toHaveBeenCalledWith("next");

    fireEvent.click(screen.getByRole("button", { name: /Veranstaltungsname/ }));
    expect(props.onSort).toHaveBeenCalledWith("name");
  });

  it("routes catalog actions without owning server state", () => {
    const props = properties();
    render(<EventCatalogDialog {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Stammdaten exportieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Stammdaten importieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Neue Veranstaltung" }));
    fireEvent.click(screen.getByRole("button", { name: "Next flight day löschen" }));

    expect(props.onExport).toHaveBeenCalledOnce();
    expect(props.onImport).toHaveBeenCalledOnce();
    expect(props.onOpenCreate).toHaveBeenCalledOnce();
    expect(props.onDelete).toHaveBeenCalledWith(events[1]);
  });

  it("projects every event phase and exposes stable sort semantics", () => {
    const phaseEvents = [
      ...events,
      { ...events[0], eventId: "demo-closed", name: "Closed flight day", status: "CLOSED" },
      { ...events[0], eventId: "demo-archived", name: "Archived flight day", status: "ARCHIVED" },
    ] as EventCatalogEntry[];
    const props = properties({
      events: phaseEvents,
      sort: { key: "status", direction: "desc" },
    });
    const rendered = render(<EventCatalogDialog {...props} />);

    expect(screen.getByText("Vorbereitung")).toBeTruthy();
    expect(screen.getByText("Aktiv")).toBeTruthy();
    expect(screen.getByText("Geschlossen")).toBeTruthy();
    expect(screen.getByText("Archiviert")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Phase/ }).getAttribute("aria-sort")).toBe(
      "descending",
    );

    rendered.rerender(
      <EventCatalogDialog {...props} events={[]} sort={{ key: "status", direction: null }} />,
    );
    expect(screen.getByText("Keine passende Veranstaltung gefunden.")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Phase/ }).getAttribute("aria-sort")).toBe(
      "none",
    );
  });

  it("keeps creation validation and normalized identifiers at the boundary", () => {
    const props = properties({ view: "create" });
    render(<EventCatalogDialog {...props} />);

    expect(screen.getByRole("dialog", { name: "Neue Veranstaltung anlegen" })).toBeTruthy();
    expect(screen.queryByLabelText("Bestätigungstext")).toBeNull();
    expect(screen.queryByText(/NEUSTART/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Technische ID"), {
      target: { value: "DEMO-2028" },
    });
    expect(props.onSetCreationId).toHaveBeenCalledWith("demo-2028");

    const form = document.getElementById("event-create-form");
    if (!form) throw new Error("Expected the event creation form.");
    fireEvent.submit(form);
    expect(props.onCreateSubmit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Zurück zu Veranstaltungen" }));
    expect(props.onShowCatalog).toHaveBeenCalledOnce();
  });

  it("shows the selected restart semantics and blocks invalid creation", () => {
    const props = properties({
      creation: {
        ...properties().creation,
        disabled: true,
        error: "Creation rejected",
        restartMode: "KEEP_MASTER_DATA",
      },
      view: "create",
    });
    render(<EventCatalogDialog {...props} />);

    expect(screen.getByText(/Übernommen werden Parameter, Gates, Ressourcengruppen/)).toBeTruthy();
    expect(screen.getByText("Creation rejected")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Veranstaltung anlegen" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("does not expose dialog content while closed", () => {
    render(<EventCatalogDialog {...properties({ view: "closed" })} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
