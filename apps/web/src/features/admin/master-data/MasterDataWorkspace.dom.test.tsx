// @vitest-environment jsdom

import type { EventSnapshot } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminEntityTable } from "./AdminEntityTable";
import { MasterDataEmptyState, MasterDataWorkspace } from "./MasterDataWorkspace";

const event = {
  eventId: "synthetic-event",
  version: 1,
  name: "Synthetischer Flugtag",
  eventDate: "2026-07-31",
  aerodrome: "EDXX",
  timeZone: "Europe/Berlin",
  status: "PREPARATION",
} as EventSnapshot;

function renderEmptyWorkspace({ filtered = false }: { filtered?: boolean } = {}) {
  const onSort = vi.fn();
  render(
    <MasterDataWorkspace
      addAriaLabel="Gate hinzufügen"
      event={event}
      onNew={vi.fn()}
      onSearchChange={vi.fn()}
      resultCount={0}
      search={filtered ? "ohne Treffer" : ""}
    >
      <AdminEntityTable
        columns={[
          {
            key: "gate",
            label: "Gate",
            render: (row: { id: string }) => row.id,
            sortKey: "label",
          },
          {
            key: "status",
            label: "Status",
            render: () => "Aktiv",
          },
        ]}
        emptyLabel={
          <MasterDataEmptyState
            description={
              filtered
                ? "Die aktuelle Suche oder Filterauswahl liefert keine Einträge."
                : "Für diese Veranstaltung sind noch keine Einträge vorhanden."
            }
            title={filtered ? "Keine Treffer" : "Noch keine Gates"}
          />
        }
        onSort={onSort}
        rowKey={(row) => row.id}
        rows={[]}
      />
    </MasterDataWorkspace>,
  );
  return { onSort };
}

afterEach(cleanup);

describe("MasterDataWorkspace", () => {
  it("keeps the header visible and renders exactly one empty state and add action", () => {
    const { onSort } = renderEmptyWorkspace();

    expect(screen.getByRole("columnheader", { name: "Gate" })).not.toBeNull();
    expect(document.querySelectorAll(".master-data-unified-empty")).toHaveLength(1);
    expect(screen.getByText("Noch keine Gates")).not.toBeNull();
    const addButton = screen.getByRole("button", { name: "Gate hinzufügen" });
    expect(addButton.textContent?.trim()).toBe("+ Hinzufügen");
    expect(screen.getAllByText("+ Hinzufügen")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Gate" }));
    expect(onSort).toHaveBeenCalledWith("label");
  });

  it("distinguishes an empty search result without adding another call to action", () => {
    renderEmptyWorkspace({ filtered: true });

    expect(screen.getByText("Keine Treffer")).not.toBeNull();
    expect(screen.queryByText("Noch keine Gates")).toBeNull();
    expect(screen.getAllByText("+ Hinzufügen")).toHaveLength(1);
  });
});
