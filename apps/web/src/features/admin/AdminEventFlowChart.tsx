import type { AdminEventFlow } from "@rundflug/contracts";
import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TimeDiagramZoomControls } from "../../shared/TimeDiagramZoomControls";
import {
  timeDiagramAxisTickValues,
  useTimeDiagramViewport,
} from "../../shared/time-diagram-viewport";

function hourLabel(value: string | number, timeZone: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function FlowTooltip({
  active,
  label,
  payload,
  timeZone,
}: Readonly<{
  active?: boolean;
  label?: number;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  timeZone: string;
}>) {
  if (!active || label === undefined || !payload?.length) return null;
  const values = new Map(payload.map((entry) => [String(entry.dataKey), Number(entry.value ?? 0)]));
  return (
    <div className="admin-flow-tooltip">
      <strong>{hourLabel(label, timeZone)} Uhr</strong>
      <span>Verkauft: {values.get("soldTickets") ?? 0}</span>
      <span>Abgeschlossen: {values.get("completedTickets") ?? 0}</span>
      <span>Offen: {values.get("openTickets") ?? 0}</span>
    </div>
  );
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
  const chartData = useMemo(
    () =>
      flow?.points.map((point) => ({
        ...point,
        time: Date.parse(point.at),
      })) ?? [],
    [flow],
  );
  const from = flow ? Date.parse(flow.from) : 0;
  const plannedUntil = flow ? Date.parse(flow.plannedUntil) : 1;
  const observedUntil = flow ? Date.parse(flow.observedUntil) : 0;
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
    insets: { left: 26, right: 16 },
    resetKey: flow ? `${flow.eventId}:${flow.from}:${flow.plannedUntil}` : "empty",
  });

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

  const finalPoint = flow.points.at(-1);
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
        zoomLevels={zoomLevels}
      />
      <div
        aria-label={`Ticketverlauf: ${finalPoint?.soldTickets ?? 0} verkauft, ${finalPoint?.completedTickets ?? 0} abgeschlossen, ${finalPoint?.openTickets ?? 0} offen.`}
        className={`admin-flow-chart time-diagram-viewport${zoom > 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`}
        onClickCapture={onClickCapture}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        ref={setViewportRef}
        role="img"
      >
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart
            accessibilityLayer={false}
            data={chartData}
            margin={{ top: 12, right: 16, bottom: 2, left: -12 }}
          >
            <CartesianGrid
              className="admin-flow-grid-line"
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              allowDataOverflow
              dataKey="time"
              domain={[visibleDomain.from, visibleDomain.until]}
              minTickGap={32}
              scale="time"
              tickFormatter={(value: number) => hourLabel(value, timeZone)}
              ticks={timeTicks}
              type="number"
            />
            <YAxis allowDecimals={false} domain={[0, "dataMax + 1"]} width={38} />
            <Tooltip
              content={<FlowTooltip timeZone={timeZone} />}
              cursor={false}
              isAnimationActive={false}
            />
            <Area
              activeDot={false}
              dataKey="completedTickets"
              fill="transparent"
              isAnimationActive={false}
              stackId="ticket-flow"
              stroke="transparent"
              type="stepAfter"
            />
            <Area
              activeDot={false}
              className="admin-flow-open-area"
              dataKey="openTickets"
              fill="var(--admin-flow-open-fill)"
              isAnimationActive={false}
              stackId="ticket-flow"
              stroke="transparent"
              type="stepAfter"
            />
            <Line
              className="admin-flow-line sold"
              activeDot={false}
              dataKey="soldTickets"
              dot={false}
              isAnimationActive={false}
              stroke="var(--ui-accent)"
              strokeWidth={1.75}
              type="stepAfter"
            />
            <Line
              className="admin-flow-line completed"
              activeDot={false}
              dataKey="completedTickets"
              dot={false}
              isAnimationActive={false}
              stroke="var(--ui-success)"
              strokeWidth={1.75}
              type="stepAfter"
            />
            {observedUntil >= visibleDomain.from && observedUntil <= visibleDomain.until ? (
              <ReferenceLine
                className="admin-flow-now-line"
                stroke="var(--ui-border-strong)"
                strokeDasharray="4 5"
                x={observedUntil}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
