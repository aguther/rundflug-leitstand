import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface TimeDomain {
  from: number;
  until: number;
}

export interface TimeDiagramInsets {
  left: number;
  right: number;
}

interface DragState {
  domain: TimeDomain;
  moved: boolean;
  plotWidth: number;
  pointerId: number;
  startClientX: number;
}

interface UseTimeDiagramViewportOptions {
  domain: TimeDomain;
  freezeDomainWhileZoomed?: boolean;
  insets?: Partial<TimeDiagramInsets>;
  insetRatios?: Partial<TimeDiagramInsets>;
  minimumVisibleSpanMs?: number;
  resetKey: unknown;
}

const DEFAULT_INSETS: TimeDiagramInsets = { left: 0, right: 0 };
const DRAG_THRESHOLD_PX = 4;
const MINUTE_MS = 60_000;

export const DEFAULT_TIME_DIAGRAM_MINIMUM_VISIBLE_SPAN_MS = 15 * MINUTE_MS;
export const TIME_DIAGRAM_ZOOM_LEVELS = [
  1, 1.5, 2, 3, 4.5, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512,
] as const;

function normalizeDomain(domain: TimeDomain): TimeDomain {
  const from = Number.isFinite(domain.from) ? domain.from : 0;
  const until = Number.isFinite(domain.until) ? domain.until : from + 1;
  return until > from ? { from, until } : { from, until: from + 1 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function timeDomainSpan(domain: TimeDomain): number {
  return Math.max(1, domain.until - domain.from);
}

export function timeDiagramZoomLevelsForSpan(
  spanMs: number,
  minimumVisibleSpanMs = DEFAULT_TIME_DIAGRAM_MINIMUM_VISIBLE_SPAN_MS,
): readonly number[] {
  if (!Number.isFinite(spanMs) || spanMs <= 0) return [1];
  const requiredZoom = Math.max(1, spanMs / Math.max(1, minimumVisibleSpanMs));
  const predefinedMaximumIndex = TIME_DIAGRAM_ZOOM_LEVELS.findIndex(
    (level) => level >= requiredZoom,
  );
  if (predefinedMaximumIndex >= 0) {
    return TIME_DIAGRAM_ZOOM_LEVELS.slice(0, predefinedMaximumIndex + 1);
  }

  const levels = [...TIME_DIAGRAM_ZOOM_LEVELS] as number[];
  while ((levels.at(-1) ?? 1) < requiredZoom) {
    levels.push((levels.at(-1) ?? 1) * 1.5);
  }
  return levels;
}

export function timeAtRatio(domain: TimeDomain, ratio: number): number {
  return domain.from + clamp(ratio, 0, 1) * timeDomainSpan(domain);
}

export function timeToPercent(value: number, domain: TimeDomain): number {
  return ((value - domain.from) / timeDomainSpan(domain)) * 100;
}

export function clipTimeInterval(
  from: number,
  until: number,
  domain: TimeDomain,
): TimeDomain | null {
  if (until < domain.from || from > domain.until) return null;
  return {
    from: clamp(from, domain.from, domain.until),
    until: clamp(until, domain.from, domain.until),
  };
}

export function zoomTimeDomain(input: {
  anchorRatio: number;
  baseDomain: TimeDomain;
  currentDomain: TimeDomain;
  nextZoom: number;
}): TimeDomain {
  const baseDomain = normalizeDomain(input.baseDomain);
  const currentDomain = normalizeDomain(input.currentDomain);
  const baseSpan = timeDomainSpan(baseDomain);
  const nextSpan = Math.min(baseSpan, baseSpan / Math.max(1, input.nextZoom));
  const ratio = clamp(input.anchorRatio, 0, 1);
  const anchorTime = timeAtRatio(currentDomain, ratio);
  const maximumFrom = baseDomain.until - nextSpan;
  const from = clamp(anchorTime - ratio * nextSpan, baseDomain.from, maximumFrom);
  return { from, until: from + nextSpan };
}

export function panTimeDomain(input: {
  baseDomain: TimeDomain;
  currentDomain: TimeDomain;
  deltaRatio: number;
}): TimeDomain {
  const baseDomain = normalizeDomain(input.baseDomain);
  const currentDomain = normalizeDomain(input.currentDomain);
  const span = Math.min(timeDomainSpan(baseDomain), timeDomainSpan(currentDomain));
  const maximumFrom = baseDomain.until - span;
  const from = clamp(currentDomain.from + input.deltaRatio * span, baseDomain.from, maximumFrom);
  return { from, until: from + span };
}

export function useTimeDiagramViewport({
  domain,
  freezeDomainWhileZoomed = false,
  insetRatios: partialInsetRatios,
  insets: partialInsets,
  minimumVisibleSpanMs = DEFAULT_TIME_DIAGRAM_MINIMUM_VISIBLE_SPAN_MS,
  resetKey,
}: UseTimeDiagramViewportOptions) {
  const domainFrom = domain.from;
  const domainUntil = domain.until;
  const externalDomain = useMemo(
    () => normalizeDomain({ from: domainFrom, until: domainUntil }),
    [domainFrom, domainUntil],
  );
  const insets = useMemo(
    () => ({
      left: Math.max(0, partialInsets?.left ?? DEFAULT_INSETS.left),
      right: Math.max(0, partialInsets?.right ?? DEFAULT_INSETS.right),
    }),
    [partialInsets?.left, partialInsets?.right],
  );
  const insetRatios = useMemo(
    () => ({
      left: Math.max(0, partialInsetRatios?.left ?? 0),
      right: Math.max(0, partialInsetRatios?.right ?? 0),
    }),
    [partialInsetRatios?.left, partialInsetRatios?.right],
  );
  const [baseDomain, setBaseDomain] = useState(externalDomain);
  const [visibleDomain, setVisibleDomain] = useState(externalDomain);
  const [dragging, setDragging] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const baseDomainRef = useRef(baseDomain);
  const visibleDomainRef = useRef(visibleDomain);
  const dragRef = useRef<DragState | null>(null);
  const insetsRef = useRef(insets);
  const insetRatiosRef = useRef(insetRatios);
  const latestExternalDomainRef = useRef(externalDomain);
  const previousResetKeyRef = useRef(resetKey);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const suppressClickRef = useRef(false);
  const viewportRef = useRef<HTMLElement | null>(null);
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => undefined);
  const wheelListenerRef = useRef<((event: WheelEvent) => void) | null>(null);
  const zoomLevels = useMemo(
    () => timeDiagramZoomLevelsForSpan(timeDomainSpan(baseDomain), minimumVisibleSpanMs),
    [baseDomain, minimumVisibleSpanMs],
  );
  const zoomLevelsRef = useRef(zoomLevels);
  const zoomRef = useRef(zoom);

  insetsRef.current = insets;
  insetRatiosRef.current = insetRatios;
  latestExternalDomainRef.current = externalDomain;
  zoomLevelsRef.current = zoomLevels;

  const updateViewport = useCallback((nextDomain: TimeDomain, nextZoom: number) => {
    visibleDomainRef.current = nextDomain;
    zoomRef.current = nextZoom;
    setVisibleDomain(nextDomain);
    setZoom(nextZoom);
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
    finishDrag(true);
    suppressClickRef.current = false;
    const nextBaseDomain = latestExternalDomainRef.current;
    baseDomainRef.current = nextBaseDomain;
    setBaseDomain(nextBaseDomain);
    updateViewport(nextBaseDomain, 1);
  }, [finishDrag, updateViewport]);

  const anchorRatioForClientX = useCallback((clientX?: number) => {
    if (clientX === undefined) return 0.5;
    const viewport = viewportRef.current;
    if (!viewport) return 0.5;
    const bounds = viewport.getBoundingClientRect();
    const currentInsets = insetsRef.current;
    const currentInsetRatios = insetRatiosRef.current;
    const leftInset = currentInsets.left + viewport.clientWidth * currentInsetRatios.left;
    const rightInset = currentInsets.right + viewport.clientWidth * currentInsetRatios.right;
    const plotWidth = Math.max(1, viewport.clientWidth - leftInset - rightInset);
    return clamp((clientX - bounds.left - leftInset) / plotWidth, 0, 1);
  }, []);

  const changeZoom = useCallback(
    (nextZoom: number, anchorClientX?: number) => {
      const levels = zoomLevelsRef.current;
      const nextIndex = levels.reduce(
        (nearest, level, index) =>
          Math.abs(level - nextZoom) < Math.abs((levels[nearest] ?? 1) - nextZoom)
            ? index
            : nearest,
        0,
      );
      const normalizedZoom = levels[nextIndex] ?? 1;
      if (normalizedZoom === zoomRef.current) return;
      finishDrag(true);
      const nextDomain = zoomTimeDomain({
        anchorRatio: anchorRatioForClientX(anchorClientX),
        baseDomain: baseDomainRef.current,
        currentDomain: visibleDomainRef.current,
        nextZoom: normalizedZoom,
      });
      updateViewport(nextDomain, normalizedZoom);
    },
    [anchorRatioForClientX, finishDrag, updateViewport],
  );

  wheelHandlerRef.current = (event: WheelEvent) => {
    if (event.deltaY === 0) return;
    const levels = zoomLevelsRef.current;
    const currentIndex = levels.indexOf(zoomRef.current);
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextIndex = clamp(currentIndex + direction, 0, levels.length - 1);
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    changeZoom(levels[nextIndex] ?? 1, event.clientX);
  };

  if (!wheelListenerRef.current) {
    wheelListenerRef.current = (event) => wheelHandlerRef.current(event);
  }

  const setViewportRef = useCallback((viewport: HTMLElement | null) => {
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

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || zoomRef.current <= 1) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const currentInsets = insetsRef.current;
    const currentInsetRatios = insetRatiosRef.current;
    const ratioInsets = viewport.clientWidth * (currentInsetRatios.left + currentInsetRatios.right);
    suppressClickRef.current = false;
    dragRef.current = {
      domain: visibleDomainRef.current,
      moved: false,
      plotWidth: Math.max(
        1,
        viewport.clientWidth - currentInsets.left - currentInsets.right - ratioInsets,
      ),
      pointerId: event.pointerId,
      startClientX: event.clientX,
    };
    viewport.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startClientX;
    if (!drag.moved && Math.abs(distance) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    setDragging(true);
    const nextDomain = panTimeDomain({
      baseDomain: baseDomainRef.current,
      currentDomain: drag.domain,
      deltaRatio: -distance / drag.plotWidth,
    });
    visibleDomainRef.current = nextDomain;
    setVisibleDomain(nextDomain);
    event.preventDefault();
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      finishDrag(true);
    },
    [finishDrag],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      finishDrag(false);
    },
    [finishDrag],
  );

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useLayoutEffect(() => {
    const resetKeyChanged = !Object.is(previousResetKeyRef.current, resetKey);
    previousResetKeyRef.current = resetKey;
    if (resetKeyChanged || zoomRef.current === 1) {
      baseDomainRef.current = externalDomain;
      visibleDomainRef.current = externalDomain;
      zoomRef.current = 1;
      setBaseDomain(externalDomain);
      setVisibleDomain(externalDomain);
      setZoom(1);
      if (resetKeyChanged) finishDrag(true);
      return;
    }
    if (freezeDomainWhileZoomed) return;

    const nextVisibleDomain = panTimeDomain({
      baseDomain: externalDomain,
      currentDomain: visibleDomainRef.current,
      deltaRatio: 0,
    });
    baseDomainRef.current = externalDomain;
    visibleDomainRef.current = nextVisibleDomain;
    setBaseDomain(externalDomain);
    setVisibleDomain(nextVisibleDomain);
  }, [externalDomain, finishDrag, freezeDomainWhileZoomed, resetKey]);

  useLayoutEffect(
    () => () => {
      finishDrag(true);
      resizeObserverRef.current?.disconnect();
      const listener = wheelListenerRef.current;
      if (listener) viewportRef.current?.removeEventListener("wheel", listener);
    },
    [finishDrag],
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
    visibleDomain,
    zoom,
    zoomLevels,
  };
}
