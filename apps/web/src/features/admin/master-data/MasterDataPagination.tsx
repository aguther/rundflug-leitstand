import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";

export function MasterDataPagination({
  count,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  count: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const from = count === 0 ? 0 : currentPage * pageSize + 1;
  const to = Math.min(count, (currentPage + 1) * pageSize);

  if (count === 0) return null;
  return (
    <div className="ds-pagination master-data-unified-pagination">
      <div className="ds-pagination-size">
        <label htmlFor="master-data-page-size">Zeilen pro Seite</label>
        <select
          id="master-data-page-size"
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          value={pageSize}
        >
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
      </div>
      <span>
        {from}–{to} von {count}
      </span>
      <nav aria-label="Seitennavigation" className="ds-pagination-nav">
        <button
          aria-label="Erste Seite"
          disabled={currentPage === 0}
          onClick={() => onPageChange(0)}
          type="button"
        >
          <ChevronFirst aria-hidden="true" />
        </button>
        <button
          aria-label="Vorherige Seite"
          disabled={currentPage === 0}
          onClick={() => onPageChange(Math.max(0, currentPage - 1))}
          type="button"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button className="current" disabled type="button">
          {currentPage + 1}
        </button>
        <button
          aria-label="Nächste Seite"
          disabled={currentPage >= pageCount - 1}
          onClick={() => onPageChange(Math.min(pageCount - 1, currentPage + 1))}
          type="button"
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <button
          aria-label="Letzte Seite"
          disabled={currentPage >= pageCount - 1}
          onClick={() => onPageChange(pageCount - 1)}
          type="button"
        >
          <ChevronLast aria-hidden="true" />
        </button>
      </nav>
    </div>
  );
}
