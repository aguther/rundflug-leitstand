// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "./DataTable";

interface Row {
  id: string;
  label: string;
}

const rows: Row[] = [
  { id: "one", label: "Eins" },
  { id: "two", label: "Zwei" },
];

describe("DataTable row classes", () => {
  afterEach(() => cleanup());

  it("keeps rowClassName optional and renders rows unchanged without it", () => {
    render(
      <DataTable
        columns={[{ key: "label", header: "Label", render: (row) => row.label }]}
        rowKey={(row) => row.id}
        rows={rows}
      />,
    );

    expect(screen.getByText("Eins").closest("tr")?.className).toBe("");
  });

  it("composes a custom row class with the selected class", () => {
    render(
      <DataTable
        columns={[{ key: "label", header: "Label", render: (row) => row.label }]}
        rowClassName={(row) => (row.id === "one" ? "recent" : undefined)}
        rowKey={(row) => row.id}
        rows={rows}
        selectedRowKey="one"
      />,
    );

    expect(screen.getByText("Eins").closest("tr")?.className.split(" ")).toEqual([
      "selected",
      "recent",
    ]);
  });

  it("renders column metadata, actions, and clickable row contracts", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable
        className="synthetic-table"
        columns={[
          {
            align: "right",
            ariaSort: "ascending",
            header: "Label",
            key: "label",
            priority: "primary",
            render: (row) => row.label,
            width: "12rem",
          },
        ]}
        onRowClick={onRowClick}
        renderRowActions={(row) => <button type="button">{row.label} bearbeiten</button>}
        rowKey={(row) => row.id}
        rows={rows}
      />,
    );

    const heading = screen.getByRole("columnheader", { name: "Label" });
    expect(heading.getAttribute("aria-sort")).toBe("ascending");
    expect(heading.className).toContain("primary");
    expect(heading.getAttribute("style")).toContain("text-align: right");
    expect(screen.getByRole("columnheader", { name: "Aktionen" })).toBeTruthy();
    expect(screen.getByRole("table").className).toContain("clickable");
    expect(screen.getByRole("table").parentElement?.className).toContain("synthetic-table");
    await user.click(screen.getByText("Eins"));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("renders a spanning empty state without pagination", () => {
    render(
      <DataTable
        columns={[
          { key: "label", header: "Label", render: (row: Row) => row.label },
          { key: "id", header: "ID", render: (row: Row) => row.id },
        ]}
        emptyLabel={<strong>Keine synthetischen Zeilen</strong>}
        renderRowActions={() => null}
        rowKey={(row) => row.id}
        rows={[]}
      />,
    );

    const emptyCell = screen.getByText("Keine synthetischen Zeilen").closest("td");
    expect(emptyCell?.getAttribute("colspan")).toBe("3");
    expect(screen.queryByRole("navigation", { name: "Seitennavigation" })).toBeNull();
  });

  it("paginates, clamps pages after data changes, and resets page size", async () => {
    const user = userEvent.setup();
    const manyRows = Array.from({ length: 7 }, (_, index) => ({
      id: `row-${index + 1}`,
      label: `Zeile ${index + 1}`,
    }));
    const view = render(
      <DataTable
        columns={[{ key: "label", header: "Label", render: (row) => row.label }]}
        pageSize={2}
        pageSizeOptions={[2, 3]}
        rowKey={(row) => row.id}
        rows={manyRows}
      />,
    );

    expect(screen.getByText("1–2 von 7")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Nächste Seite" }));
    expect(screen.getByText("3–4 von 7")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Letzte Seite" }));
    expect(screen.getByText("7–7 von 7")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Vorherige Seite" }));
    expect(screen.getByText("5–6 von 7")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Erste Seite" }));
    expect(screen.getByText("1–2 von 7")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Nächste Seite" }));
    view.rerender(
      <DataTable
        columns={[{ key: "label", header: "Label", render: (row) => row.label }]}
        pageSize={2}
        pageSizeOptions={[2, 3]}
        rowKey={(row) => row.id}
        rows={manyRows.slice(0, 1)}
      />,
    );
    expect(screen.getByText("1–1 von 1")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Zeilen pro Seite"), { target: { value: "3" } });
    expect(screen.getByText("1–1 von 1")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Nächste Seite" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
