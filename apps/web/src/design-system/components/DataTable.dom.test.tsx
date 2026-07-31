// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
