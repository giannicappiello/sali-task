import { useCallback, useMemo, useRef, useState } from "react";
import {
  applyDatasetTableQuery,
  TABLE_COLUMN_QUERY_EVENT,
} from "./tableColumnControls";

const EMPTY_QUERY = Object.freeze({ direction: "asc", filters: {}, sortColumn: null });

export function useDatasetTableControls({ onQueryChange } = {}) {
  const currentTable = useRef(null);
  const [query, setQuery] = useState(EMPTY_QUERY);
  const handleQuery = useCallback((event) => {
      setQuery(event.detail);
      onQueryChange?.(event.detail);
  }, [onQueryChange]);

  const tableRef = useCallback((table) => {
    currentTable.current?.removeEventListener(TABLE_COLUMN_QUERY_EVENT, handleQuery);
    currentTable.current = table;
    table?.addEventListener(TABLE_COLUMN_QUERY_EVENT, handleQuery);
  }, [handleQuery]);

  return [tableRef, query];
}

export function usePaginatedDataset(rows, columns, query, page, pageSize) {
  const queriedRows = useMemo(
    () => applyDatasetTableQuery(rows, columns, query),
    [columns, query, rows],
  );
  const pageRows = useMemo(
    () => queriedRows.slice(page * pageSize, (page + 1) * pageSize),
    [page, pageSize, queriedRows],
  );
  return { pageRows, total: queriedRows.length };
}

export function useResetPageCallback(setPage) {
  return useCallback(() => setPage(0), [setPage]);
}
