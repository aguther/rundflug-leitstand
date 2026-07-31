import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export const ANALYTICS_ZOOM_LEVELS = [1, 1.5, 2, 3, 4.5, 6, 8, 12, 16, 24, 32] as const;
export const ANALYTICS_TARGET_VISIBLE_MINUTES = 90;
const DRAG_THRESHOLD_PX = 4;
const MINUTE_MS = 60_000;

interface DragState {
  moved: boolean;
  pointerId: number;
  startClientX: number;
  startScrollLeft: number;
}

export function analyticsZoomLevelsForSpan(spanMs: number): readonly number[] {
  if (!Number.isFinite(spanMs) || spanMs <= 0) return [1];
  const requiredZoom = Math.max(1, spanMs / (ANALYTICS_TARGET_VISIBLE_MINUTES * MINUTE_MS));
  const maximumIndex = ANALYTICS_ZOOM_LEVELS.findIndex((level) => level >= requiredZoom);
  return ANALYTICS_ZOOM_LEVELS.slice(
    0,
    maximumIndex < 0 ? ANALYTICS_ZOOM_LEVELS.length : maximumIndex + 1,
  );
}

export function useAnalyticsDiagramViewport(
  resetKey: string,
  zoomLevels: readonly number[] = ANALYTICS_ZOOM_LEVELS,
) {
  const [dragging, setDragging] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const animationFrameRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const suppressClickRef = useRef(false);
  const previousResetKeyRef = useRef<string | null>(null);
  const selectStartListenerRef = useRef<((event: Event) => void) | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => undefined);
  const wheelListenerRef = useRef<((event: WheelEvent) => void) | null>(null);
  const zoomRef = useRef(1);

  const cancelScheduledScroll = useCallback(() => {
    if (animationFrameRef.current === null) return;
    window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }, []);

  const finishDrag = useCallback((releaseCapture: boolean) => {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    if (releaseCapture && drag && viewport?.hasPointerCapture(drag.pointerId)) {
      viewport.releasePointerCapture(drag.pointerId);
    }
    if (drag?.moved) suppressClickRef.current = true;
    dragRef.current = null;
    setDragging(false);
  }, []);

  const reset = useCallback(() => {
    cancelScheduledScroll();
    finishDrag(true);
    suppressClickRef.current = false;
    zoomRef.current = 1;
    setZoom(1);
    if (viewportRef.current) viewportRef.current.scrollLeft = 0;
  }, [cancelScheduledScroll, finishDrag]);

  const changeZoom = useCallback(
    (nextZoom: number, anchorClientX?: number) => {
      const viewport = viewportRef.current;
      const nextIndex = zoomLevels.reduce(
        (nearest, level, index) =>
          Math.abs(level - nextZoom) < Math.abs((zoomLevels[nearest] ?? 1) - nextZoom)
            ? index
            : nearest,
        0,
      );
      const normalizedZoom = zoomLevels[nextIndex] ?? 1;
      if (normalizedZoom === zoomRef.current) return;

      let anchorOffset = 0;
      let anchorRatio = 0.5;
      if (viewport) {
        const bounds = viewport.getBoundingClientRect();
        anchorOffset =
          anchorClientX === undefined
            ? viewport.clientWidth / 2
            : Math.min(viewport.clientWidth, Math.max(0, anchorClientX - bounds.left));
        anchorRatio =
          viewport.scrollWidth > 0
            ? (viewport.scrollLeft + anchorOffset) / viewport.scrollWidth
            : 0.5;
      }

      cancelScheduledScroll();
      finishDrag(true);
      zoomRef.current = normalizedZoom;
      setZoom(normalizedZoom);
      if (!viewport) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, anchorRatio * viewport.scrollWidth - anchorOffset);
        animationFrameRef.current = null;
      });
    },
    [cancelScheduledScroll, finishDrag, zoomLevels],
  );

  wheelHandlerRef.current = (event: WheelEvent) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    const currentIndex = zoomLevels.indexOf(zoomRef.current);
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextIndex = Math.min(zoomLevels.length - 1, Math.max(0, currentIndex + direction));
    changeZoom(zoomLevels[nextIndex] ?? 1, event.clientX);
  };

  if (!wheelListenerRef.current) {
    wheelListenerRef.current = (event) => wheelHandlerRef.current(event);
  }

  if (!selectStartListenerRef.current) {
    selectStartListenerRef.current = (event) => {
      if (dragRef.current) event.preventDefault();
    };
  }

  const setViewportRef = useCallback((viewport: HTMLDivElement | null) => {
    const listener = wheelListenerRef.current;
    const selectStartListener = selectStartListenerRef.current;
    const previousViewport = viewportRef.current;
    if (listener) previousViewport?.removeEventListener("wheel", listener);
    if (selectStartListener) {
      previousViewport?.removeEventListener("selectstart", selectStartListener);
    }
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    viewportRef.current = viewport;
    if (!viewport) return;

    setViewportWidth(viewport.clientWidth);
    if (listener) viewport.addEventListener("wheel", listener, { passive: false });
    if (selectStartListener) viewport.addEventListener("selectstart", selectStartListener);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserverRef.current = new ResizeObserver(([entry]) => {
        if (entry) setViewportWidth(entry.contentRect.width);
      });
      resizeObserverRef.current.observe(viewport);
    }
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    suppressClickRef.current = false;
    dragRef.current = {
      moved: false,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: viewport.scrollLeft,
    };
    viewport.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    if (!viewport || !drag || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startClientX;
    if (!drag.moved && Math.abs(distance) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    setDragging(true);
    viewport.scrollLeft = drag.startScrollLeft - distance;
    event.preventDefault();
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      finishDrag(true);
    },
    [finishDrag],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      finishDrag(false);
    },
    [finishDrag],
  );

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return;
    previousResetKeyRef.current = resetKey;
    reset();
  }, [reset, resetKey]);

  useEffect(() => {
    const maximumZoom = zoomLevels.at(-1) ?? 1;
    if (zoomRef.current > maximumZoom) changeZoom(maximumZoom);
  }, [changeZoom, zoomLevels]);

  useEffect(
    () => () => {
      cancelScheduledScroll();
      finishDrag(true);
      resizeObserverRef.current?.disconnect();
      const listener = wheelListenerRef.current;
      const selectStartListener = selectStartListenerRef.current;
      if (listener) viewportRef.current?.removeEventListener("wheel", listener);
      if (selectStartListener) {
        viewportRef.current?.removeEventListener("selectstart", selectStartListener);
      }
    },
    [cancelScheduledScroll, finishDrag],
  );

  return {
    changeZoom,
    dragging,
    onClickCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    reset,
    setViewportRef,
    viewportWidth,
    zoom,
    zoomLevels,
  };
}
