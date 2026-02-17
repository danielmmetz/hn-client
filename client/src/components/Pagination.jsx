export function Pagination({ page, hasMore, onPageChange }) {
  return (
    <div class="pagination">
      <button
        class="pagination-btn"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        ← Prev
      </button>
      <span class="pagination-info">Page {page}</span>
      <button
        class="pagination-btn"
        disabled={!hasMore}
        onClick={() => onPageChange(page + 1)}
      >
        Next →
      </button>
    </div>
  );
}
