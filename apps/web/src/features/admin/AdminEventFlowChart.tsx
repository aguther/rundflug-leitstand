import type { AdminEventFlow } from "@rundflug/contracts";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useState,
} from "react";
import { TimeDiagramZoomControls } from "../../shared/TimeDiagramZoomControls";
import {
  timeAtRatio,
  timeDiagramAxisTickValues,
  useTimeDiagramViewport,
} from "../../shared/time-diagram-viewport";
import { TimeSeriesSvgChart } from "../../shared/time-series-svg-chart";

const ADMIN_FLOW_CHART_INSETS = { left: 26, right: 16 } as const;
const MINUTE_MS = 60_000;
const TOOLTIP_GAP_PX = 16;
const TOOLTIP_HEIGHT_PX = 94;
const HOVER_DOT_RADIUS = 4.5;

type FlowChartPoint = AdminEventFlow["points"][number] & { time: number };

interface FlowHoverState {
  at: number;
  left: number;
  point: FlowChartPoint;
  top: number;
}

function hourLabel(value: string | number, timeZone: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function FlowTooltip({
  at,
  point,
  timeZone,
}: Readonly<{
  at: number;
  point: FlowChartPoint;
  timeZone: string;
}>) {
  return (
    <div aria-hidden="true" className="admin-flow-tooltip">
      <strong>{hourLabel(at, timeZone)} Uhr</strong>
      <span>Verkauft: {point.soldTickets}</span>
      <span>Abgeschlossen: {point.completedTickets}</span>
      <span>Offen: {point.openTickets}</span>
    </div>
  );
}

function flowPointAtTime(chartData: readonly FlowChartPoint[], at: number): FlowChartPoint | null {
  let matchingPoint = chartData[0] ?? null;
  for (const point of chartData) {
    if (point.time > at) break;
    matchingPoint = point;
  }
  return matchingPoint;
}

export function AdminEventFlowChart({
  averageWaitMinutes,
  error,
  flow,
  loading,
  timeZone,
}: Readonly<{
  averageWaitMinutes: number | null;
  error: string | null;
  flow: AdminEventFlow | null;
  loading: boolean;
  timeZone: string;
}>) {
  const from = flow ? Date.parse(flow.from) : 0;
  const plannedUntil = flow ? Date.parse(flow.plannedUntil) : 1;
  const observedUntil = flow ? Date.parse(flow.observedUntil) : 0;
  const chartData = useMemo(
    () =>
      flow?.points
        .map((point) => ({
          ...point,
          time: Date.parse(point.at),
        }))
        .filter((point) => point.time <= observedUntil) ?? [],
    [flow, observedUntil],
  );
  const [hover, setHover] = useState<FlowHoverState | null>(null);
  const {
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
  } = useTimeDiagramViewport({
    domain: { from, until: plannedUntil },
    insets: ADMIN_FLOW_CHART_INSETS,
    resetKey: flow ? `${flow.eventId}:${flow.from}:${flow.plannedUntil}` : "empty",
  });

  const updateHover = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.buttons !== 0) {
        setHover(null);
        return;
      }
      const viewport = event.currentTarget;
      const bounds = viewport.getBoundingClientRect();
      const plotWidth = Math.max(
        1,
        viewport.clientWidth - ADMIN_FLOW_CHART_INSETS.left - ADMIN_FLOW_CHART_INSETS.right,
      );
      const ratio = Math.min(
        1,
        Math.max(0, (event.clientX - bounds.left - ADMIN_FLOW_CHART_INSETS.left) / plotWidth),
      );
      const pointerTime = timeAtRatio(visibleDomain, ratio);
      if (pointerTime > observedUntil) {
        setHover(null);
        return;
      }
      const at = Math.min(
        observedUntil,
        visibleDomain.until,
        Math.max(visibleDomain.from, Math.round(pointerTime / MINUTE_MS) * MINUTE_MS),
      );
      const point = flowPointAtTime(chartData, at);
      if (!point) {
        setHover(null);
        return;
      }
      const pointerTop = event.clientY - bounds.top;
      const chartHeight = Math.max(1, bounds.height || viewport.clientHeight);
      const tooltipFitsBelow = pointerTop + TOOLTIP_GAP_PX + TOOLTIP_HEIGHT_PX <= chartHeight;
      setHover({
        at,
        left: ADMIN_FLOW_CHART_INSETS.left + ratio * plotWidth,
        point,
        top: tooltipFitsBelow
          ? pointerTop + TOOLTIP_GAP_PX
          : Math.max(8, pointerTop - TOOLTIP_GAP_PX - TOOLTIP_HEIGHT_PX),
      });
    },
    [chartData, observedUntil, visibleDomain],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      onPointerMove(event);
      updateHover(event);
    },
    [onPointerMove, updateHover],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      setHover(null);
      onPointerDown(event);
    },
    [onPointerDown],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      onPointerUp(event);
      if (!dragging) updateHover(event);
    },
    [dragging, onPointerUp, updateHover],
  );

  const preventChartFocus = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  if (loading) {
    return (
      <section className="admin-flow-panel" aria-busy="true">
        <div className="admin-flow-heading">
          <div>
            <h2>Verkauf und Abarbeitung</h2>
            <p>Der bestätigte Ticketverlauf wird geladen.</p>
          </div>
        </div>
        <div className="admin-flow-placeholder" />
      </section>
    );
  }
  if (!flow || error || chartData.length === 0) {
    return (
      <section className="admin-flow-panel">
        <div className="admin-flow-heading">
          <div>
            <h2>Verkauf und Abarbeitung</h2>
            <p>{error ?? "Für diese Veranstaltung liegen noch keine Verlaufsdaten vor."}</p>
          </div>
        </div>
        <div className="admin-flow-empty">Noch keine bestätigten Ticketbewegungen.</div>
      </section>
    );
  }

  const finalPoint = chartData.at(-1);
  const summary = [
    { label: "Verkauft", value: finalPoint?.soldTickets ?? 0 },
    { label: "Abgeschlossen", value: finalPoint?.completedTickets ?? 0 },
    { label: "Offen", value: finalPoint?.openTickets ?? 0 },
    {
      label: "Ø Wartezeit",
      value: averageWaitMinutes === null ? "–" : `${Math.round(averageWaitMinutes)} Min.`,
    },
  ];
  const timeTicks = timeDiagramAxisTickValues({
    domain: visibleDomain,
    pixelWidth: Math.max(320, viewportWidth || 720) - 42,
  });
  const yStep = Math.max(
    1,
    Math.ceil(Math.max(...chartData.map((point) => point.soldTickets), 1) / 4),
  );
  const yMaximum = yStep * 4;
  const chartWidth = Math.max(320, viewportWidth || 720);
  const svgSeries = [
    {
      color: "var(--ui-accent)",
      curve: "stepAfter" as const,
      id: "sold",
      label: "Verkauft",
      points: chartData.map((point) => ({ x: point.time, y: point.soldTickets })),
    },
    {
      color: "var(--ui-success)",
      curve: "stepAfter" as const,
      id: "completed",
      label: "Abgeschlossen",
      points: chartData.map((point) => ({ x: point.time, y: point.completedTickets })),
    },
  ];

  return (
    <section className="admin-flow-panel">
      <div className="admin-flow-heading">
        <div>
          <h2>Verkauf und Abarbeitung</h2>
          <p>
            Kumulierte gültige Tickets · {flow.bucketMinutes}-Minuten-Raster · Stand{" "}
            {hourLabel(flow.observedUntil, timeZone)}
          </p>
        </div>
        <fieldset className="admin-flow-legend">
          <legend className="visually-hidden">Legende</legend>
          <span className="sold">Verkauft</span>
          <span className="completed">Abgeschlossen</span>
          <span className="open">Differenz offen</span>
        </fieldset>
      </div>
      <dl className="admin-flow-summary">
        {summary.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <TimeDiagramZoomControls
        onChange={changeZoom}
        onReset={reset}
        value={zoom}
        visibleSpanMs={visibleDomain.until - visibleDomain.from}
        zoomLevels={zoomLevels}
      />
      <div
        aria-label={`Ticketverlauf: ${finalPoint?.soldTickets ?? 0} verkauft, ${finalPoint?.completedTickets ?? 0} abgeschlossen, ${finalPoint?.openTickets ?? 0} offen.`}
        className={`admin-flow-chart time-diagram-viewport${zoom > 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`}
        onClickCapture={onClickCapture}
        onMouseDownCapture={preventChartFocus}
        onPointerCancel={onPointerCancel}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => setHover(null)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheelCapture={() => setHover(null)}
        ref={setViewportRef}
        role="img"
      >
        <TimeSeriesSvgChart
          activePoints={
            hover
              ? [
                  {
                    color: "var(--ui-accent)",
                    id: "sold",
                    radius: HOVER_DOT_RADIUS,
                    x: hover.at,
                    y: hover.point.soldTickets,
                  },
                  {
                    color: "var(--ui-success)",
                    id: "completed",
                    radius: HOVER_DOT_RADIUS,
                    x: hover.at,
                    y: hover.point.completedTickets,
                  },
                ]
              : []
          }
          areaBand={{
            color: "var(--admin-flow-open-fill)",
            lower: chartData.map((point) => ({ x: point.time, y: point.completedTickets })),
            upper: chartData.map((point) => ({ x: point.time, y: point.soldTickets })),
          }}
          className="admin-flow-svg"
          formatXTick={(value) => hourLabel(value, timeZone)}
          formatYTick={(value) => String(Math.round(value))}
          height={210}
          insets={{ bottom: 22, left: 26, right: 16, top: 12 }}
          series={svgSeries}
          verticalReferences={
            observedUntil >= visibleDomain.from && observedUntil <= visibleDomain.until
              ? [{ color: "var(--ui-border-strong)", dash: "4 5", value: observedUntil }]
              : []
          }
          width={chartWidth}
          xDomain={[visibleDomain.from, visibleDomain.until]}
          xTicks={timeTicks}
          yDomain={[0, yMaximum]}
          yTicks={[0, yStep, yStep * 2, yStep * 3, yMaximum]}
        />
        {hover ? (
          <div
            className="admin-flow-tooltip-position"
            data-edge={hover.left > Math.max(1, viewportWidth) - 150 ? "right" : "default"}
            style={{ left: hover.left, top: hover.top }}
          >
            <FlowTooltip at={hover.at} point={hover.point} timeZone={timeZone} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
