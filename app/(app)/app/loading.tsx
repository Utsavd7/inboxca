// A quiet outline of a page while the next one loads, so moving between pages feels instant.
export default function Loading() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      <span className="skeleton-title" />
      {Array.from({ length: 6 }, (_, row) => <span key={row} />)}
    </div>
  );
}
