import { useCallback, useEffect, useRef, useState } from "react";

export function useTemporaryRowHighlights(visibleRowIds: readonly string[], durationMs = 3_000) {
  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const queuedIdsRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, number>());

  const queueHighlight = useCallback((rowId: string) => {
    if (!rowId || queuedIdsRef.current.has(rowId)) return;
    queuedIdsRef.current.add(rowId);
    setPendingIds((current) => {
      const next = new Set(current);
      next.add(rowId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (pendingIds.size === 0) return;
    const visibleIds = new Set(visibleRowIds);
    const newlyVisibleIds = [...pendingIds].filter((rowId) => visibleIds.has(rowId));
    if (newlyVisibleIds.length === 0) return;
    setPendingIds((current) => {
      const next = new Set(current);
      for (const rowId of newlyVisibleIds) next.delete(rowId);
      return next;
    });
    for (const rowId of newlyVisibleIds) {
      setHighlightedIds((current) => {
        const next = new Set(current);
        next.add(rowId);
        return next;
      });
      const timer = window.setTimeout(() => {
        timersRef.current.delete(rowId);
        setHighlightedIds((current) => {
          if (!current.has(rowId)) return current;
          const next = new Set(current);
          next.delete(rowId);
          return next;
        });
      }, durationMs);
      timersRef.current.set(rowId, timer);
    }
  }, [durationMs, pendingIds, visibleRowIds]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) window.clearTimeout(timer);
      timersRef.current.clear();
    },
    [],
  );

  return { highlightedIds, queueHighlight };
}
