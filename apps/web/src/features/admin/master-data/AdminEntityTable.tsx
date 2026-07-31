import type { ReactNode } from "react";
import {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
} from "../../../design-system/components";

export interface AdminEntityTableColumn<Row> extends Omit<DataTableColumn<Row>, "header"> {
  label: string;
  sortKey?: string | undefined;
}

export function AdminEntityTable<Row>({
  columns,
  sortKey,
  sortDirection,
  onSort,
  ...tableProps
}: Omit<DataTableProps<Row>, "columns"> & {
  columns: AdminEntityTableColumn<Row>[];
  sortKey?: string | undefined;
  sortDirection?: "asc" | "desc" | null | undefined;
  onSort?: ((key: string) => void) | undefined;
}) {
  const tableColumns: DataTableColumn<Row>[] = columns.map(({ label, sortKey: columnSort, ...column }) => ({
    ...column,
    ...(columnSort
      ? {
          ariaSort:
            sortKey === columnSort && sortDirection
              ? sortDirection === "asc"
                ? ("ascending" as const)
                : ("descending" as const)
              : ("none" as const),
        }
      : {}),
    header:
      columnSort && onSort ? (
        <button
          className="admin-sort-button"
          onClick={() => onSort(columnSort)}
          type="button"
        >
          {label}
          <span aria-hidden="true">
            {sortKey === columnSort && sortDirection
              ? sortDirection === "asc"
                ? "↑"
                : "↓"
              : "↕"}
          </span>
        </button>
      ) : (
        (label as ReactNode)
      ),
  }));

  return <DataTable {...tableProps} columns={tableColumns} />;
}
