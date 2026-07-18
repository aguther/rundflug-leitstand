import { type ReactNode, useMemo, useState } from "react";

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  selectedRowKey?: string;
  onRowClick?: (row: Row) => void;
  renderRowActions?: (row: Row) => ReactNode;
  emptyLabel?: ReactNode;
  pageSize?: number;
  pageSizeOptions?: number[];
  className?: string;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  selectedRowKey,
  onRowClick,
  renderRowActions,
  emptyLabel = "Keine Einträge vorhanden.",
  pageSize,
  pageSizeOptions = [10, 25, 50],
  className = "",
}: DataTableProps<Row>) {
  const paginated = pageSize !== undefined;
  const [rowsPerPage, setRowsPerPage] = useState(pageSize ?? rows.length);
  const [page, setPage] = useState(0);

  const pageCount = paginated ? Math.max(1, Math.ceil(rows.length / rowsPerPage)) : 1;
  const currentPage = Math.min(page, pageCount - 1);

  const visibleRows = useMemo(() => {
    if (!paginated) return rows;
    const start = currentPage * rowsPerPage;
    return rows.slice(start, start + rowsPerPage);
  }, [rows, paginated, currentPage, rowsPerPage]);

  const from = paginated && rows.length > 0 ? currentPage * rowsPerPage + 1 : 0;
  const to = paginated ? Math.min(rows.length, currentPage * rowsPerPage + rowsPerPage) : rows.length;

  return (
    <div className={`ds-table-scroll ${className}`.trim()}>
      <table className={`ds-table ${onRowClick ? "ds-table--clickable" : ""}`.trim()}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={{ width: column.width, textAlign: column.align ?? "left" }}>
                {column.header}
              </th>
            ))}
            {renderRowActions ? <th style={{ textAlign: "right" }}>Aktionen</th> : null}
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (renderRowActions ? 1 : 0)}>
                <div className="ds-table-empty">{emptyLabel}</div>
              </td>
            </tr>
          ) : (
            visibleRows.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  className={key === selectedRowKey ? "selected" : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key} style={{ textAlign: column.align ?? "left" }}>
                      {column.render(row)}
                    </td>
                  ))}
                  {renderRowActions ? (
                    <td>
                      <div className="ds-table-actions">{renderRowActions(row)}</div>
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {paginated && rows.length > 0 ? (
        <div className="ds-pagination">
          <div className="ds-pagination-size">
            <label htmlFor="ds-pagination-size-select">Zeilen pro Seite</label>
            <select
              id="ds-pagination-size-select"
              value={rowsPerPage}
              onChange={(event) => {
                setRowsPerPage(Number(event.target.value));
                setPage(0);
              }}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <span>
            {from}–{to} von {rows.length}
          </span>
          <nav className="ds-pagination-nav" aria-label="Seitennavigation">
            <button type="button" disabled={currentPage === 0} onClick={() => setPage(0)} aria-label="Erste Seite">
              «
            </button>
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              aria-label="Vorherige Seite"
            >
              ‹
            </button>
            <button type="button" className="current" disabled>
              {currentPage + 1}
            </button>
            <button
              type="button"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              aria-label="Nächste Seite"
            >
              ›
            </button>
            <button
              type="button"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(pageCount - 1)}
              aria-label="Letzte Seite"
            >
              »
            </button>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
