import { useCallback, useEffect, useRef } from 'react';
import { registerTableTotals } from '../../shared/screen-export/totals.js';

export function useReportTableTotals(getRows) {
  const table = useRef(null), cleanup = useRef(null);
  const ref = useCallback(node => {
    cleanup.current?.(); table.current = node;
    cleanup.current = registerTableTotals(node, getRows);
  }, [getRows]);
  useEffect(() => () => cleanup.current?.(), []);
  return ref;
}
