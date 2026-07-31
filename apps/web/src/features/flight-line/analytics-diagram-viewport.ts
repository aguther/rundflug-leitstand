import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export const ANALYTICS_ZOOM_LEVELS = [1, 1.5, 2, 3, 4.5, 6, 8] as const;
const DRAG_THRESHOLD_PX = 4;

interface DragState {
  moved: boolean;
  pointerId: number;
  startClientX: number;
  startScrollLeft: number;
}

export function useAnalyticsDiagramViewport(resetKey: string) {
  const [dragging, setDragging] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const animationFrameRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const suppressClickRef = useRef(false);
  const previousResetKeyRef = useRef<string | null>(null);
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
      const nextIndex = ANALYTICS_ZOOM_LEVELS.reduce(
        (nearest, level, index) =>
          Math.abs(level - nextZoom) < Math.abs((ANALYTICS_ZOOM_LEVELS[nearest] ?? 1) - nextZoom)
            ? index
            : nearest,
        0,
      );
      const normalizedZoom = ANALYTICS_ZOOM_LEVELS[nextIndex] ?? 1;
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
    [cancelScheduledScroll, finishDrag],
  );

  wheelHandlerRef.current = (event: WheelEvent) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    const currentIndex = ANALYTICS_ZOOM_LEVELS.indexOf(
      zoomRef.current as (typeof ANALYTICS_ZOOM_LEVELS)[number],
    );
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextIndex = Math.min(
      ANALYTICS_ZOOM_LEVELS.length - 1,
      Math.max(0, currentIndex + direction),
    );
    changeZoom(ANALYTICS_ZOOM_LEVELS[nextIndex] ?? 1, event.clientX);
  };

  if (!wheelListenerRef.current) {
    wheelListenerRef.current = (event) => wheelHandlerRef.current(event);
  }

  const setViewportRef = useCallback((viewport: HTMLDivElement | null) => {
    const listener = wheelListenerRef.current;
    const previousViewport = viewportRef.current;
    if (listener) previousViewport?.removeEventListener("wheel", listener);
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    viewportRef.current = viewport;
    if (!viewport) return;

    setViewportWidth(viewport.clientWidth);
    if (listener) viewport.addEventListener("wheel", listener, { passive: false });
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

  useEffect(
    () => () => {
      cancelScheduledScroll();
      finishDrag(true);
      resizeObserverRef.current?.disconnect();
      const listener = wheelListenerRef.current;
      if (listener) viewportRef.current?.removeEventListener("wheel", listener);
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
    zoomLevels: ANALYTICS_ZOOM_LEVELS,
  };
}
