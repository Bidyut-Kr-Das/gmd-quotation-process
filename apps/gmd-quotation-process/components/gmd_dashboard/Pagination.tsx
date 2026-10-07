"use client";

interface PaginationProps {
  total: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

const btnBase =
  "bg-card border border-border rounded text-foreground px-2.5 py-1.5 text-xs font-semibold cursor-pointer transition-all hover:border-muted-foreground/50 disabled:opacity-40 disabled:cursor-not-allowed min-w-[32px] text-center";

export default function Pagination({
  total,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange
}: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);
  const hasPagination = totalPages > 1;

  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, total);

  const getPageNumbers = () => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  const pageNumbers = hasPagination ? getPageNumbers() : [];

  // The footer is always rendered (even with a single page / no rows) so the
  // table card keeps a constant height when a filter or dropdown selection
  // reduces the row count. The right block keeps a fixed height so the bar does
  // not shrink when the page controls are hidden.
  return (
    <div className="bg-muted border-t border-border px-4 py-2.5 flex items-center justify-between text-xs">
      <div className="flex items-center gap-2">
        <span className="text-foreground font-medium">
          {total === 0
            ? "No records"
            : `Showing ${from}–${to} of ${total.toLocaleString()}`}
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
          className="bg-card border border-border rounded px-2 py-1 text-xs text-foreground font-semibold outline-none cursor-pointer"
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={1000}>1000</option>
        </select>
      </div>
      <div className="flex items-center gap-1.5 h-8">
        {hasPagination && (
          <>
            <button
              className={btnBase}
              disabled={currentPage === 1}
              onClick={() => onPageChange(1)}
            >
              FIRST
            </button>
            <button
              className={btnBase}
              disabled={currentPage === 1}
              onClick={() => onPageChange(currentPage - 1)}
            >
              PREV
            </button>
            {pageNumbers.map((page, i) =>
              page === "..." ? (
                <span
                  key={`e${i}`}
                  className="px-1 text-muted-foreground/60 font-semibold"
                >
                  ...
                </span>
              ) : (
                <button
                  key={page}
                  className={`${btnBase} ${
                    page === currentPage
                      ? "bg-[#0070f3]! border-[#0070f3]! text-white! dark:bg-primary! dark:border-primary! dark:text-primary-foreground!"
                      : ""
                  }`}
                  onClick={() => onPageChange(page)}
                >
                  {page}
                </button>
              ),
            )}
            <button
              className={btnBase}
              disabled={currentPage === totalPages}
              onClick={() => onPageChange(currentPage + 1)}
            >
              NEXT
            </button>
            <button
              className={btnBase}
              disabled={currentPage === totalPages}
              onClick={() => onPageChange(totalPages)}
            >
              LAST
            </button>
          </>
        )}
      </div>
    </div>
  );
}
