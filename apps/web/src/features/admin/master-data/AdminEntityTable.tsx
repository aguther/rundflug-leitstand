import type { ReactNode } from "react";
import {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
} from "../../../design-system/components";

export interface AdminEntityTableColumn<Row> extends Omit<DataTableColumn<Row>, "header"> {
  label: string;
  sortKey?: string;
}

function ariaSortFor(
  active: boolean,
  direction: "asc" | "desc" | null | undefined,
): "ascending" | "descending" | "none" {
  if (!active || !direction) return "none";
  return direction === "asc" ? "ascending" : "descending";
}

function sortIndicator(active: boolean, direction: "asc" | "desc" | null | undefined): string {
  if (!active || !direction) return "↕";
  return direction === "asc" ? "↑" : "↓";
}

export function AdminEntityTable<Row>({
  columns,
  sortKey,
  sortDirection,
  onSort,
  ...tableProps
}: Omit<DataTableProps<Row>, "columns"> & {
  columns: AdminEntityTableColumn<Row>[];
  sortKey?: string;
  sortDirection?: "asc" | "desc" | null;
  onSort?: (key: string) => void;
}) {
  const tableColumns: DataTableColumn<Row>[] = columns.map(
    ({ label, sortKey: columnSort, ...column }) => ({
      ...column,
      ...(columnSort
        ? {
            ariaSort: ariaSortFor(sortKey === columnSort, sortDirection),
          }
        : {}),
      header:
        columnSort && onSort ? (
          <button className="admin-sort-button" onClick={() => onSort(columnSort)} type="button">
            {label}
            <span aria-hidden="true">{sortIndicator(sortKey === columnSort, sortDirection)}</span>
          </button>
        ) : (
          (label as ReactNode)
        ),
    }),
  );

  return <DataTable {...tableProps} columns={tableColumns} />;
}
