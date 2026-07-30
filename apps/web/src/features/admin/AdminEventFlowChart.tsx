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
}: {
  active?: boolean;
  label?: number | undefined;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  timeZone: string;
}) {
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
}: {
  averageWaitMinutes: number | null;
  error: string | null;
  flow: AdminEventFlow | null;
  loading: boolean;
  timeZone: string;
}) {
  const chartData = useMemo(
    () =>
      flow?.points.map((point) => ({
        ...point,
        time: Date.parse(point.at),
      })) ?? [],
    [flow],
  );

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
  const from = Date.parse(flow.from);
  const plannedUntil = Date.parse(flow.plannedUntil);
  const observedUntil = Date.parse(flow.observedUntil);
  const summary = [
    { label: "Verkauft", value: finalPoint?.soldTickets ?? 0 },
    { label: "Abgeschlossen", value: finalPoint?.completedTickets ?? 0 },
    { label: "Offen", value: finalPoint?.openTickets ?? 0 },
    {
      label: "Ø Wartezeit",
      value: averageWaitMinutes === null ? "–" : `${Math.round(averageWaitMinutes)} Min.`,
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
      <div
        aria-label={`Ticketverlauf: ${finalPoint?.soldTickets ?? 0} verkauft, ${finalPoint?.completedTickets ?? 0} abgeschlossen, ${finalPoint?.openTickets ?? 0} offen.`}
        className="admin-flow-chart"
        role="img"
      >
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart
            accessibilityLayer
            data={chartData}
            margin={{ top: 12, right: 16, bottom: 2, left: -12 }}
          >
            <CartesianGrid
              className="admin-flow-grid-line"
              strokeDasharray="2 4"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              domain={[from, plannedUntil]}
              minTickGap={48}
              scale="time"
              tickFormatter={(value: number) => hourLabel(value, timeZone)}
              type="number"
            />
            <YAxis allowDecimals={false} domain={[0, "dataMax + 1"]} width={38} />
            <Tooltip
              content={(props) => (
                <FlowTooltip
                  active={props.active}
                  label={typeof props.label === "number" ? props.label : undefined}
                  payload={props.payload}
                  timeZone={timeZone}
                />
              )}
              cursor={{ stroke: "var(--ui-border-strong)", strokeDasharray: "3 4" }}
            />
            <Area
              dataKey="completedTickets"
              fill="transparent"
              isAnimationActive={false}
              stackId="ticket-flow"
              stroke="transparent"
              type="stepAfter"
            />
            <Area
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
              dataKey="soldTickets"
              dot={false}
              isAnimationActive={false}
              stroke="var(--ui-accent)"
              strokeWidth={1.75}
              type="stepAfter"
            />
            <Line
              className="admin-flow-line completed"
              dataKey="completedTickets"
              dot={false}
              isAnimationActive={false}
              stroke="var(--ui-success)"
              strokeWidth={1.75}
              type="stepAfter"
            />
            <ReferenceLine
              className="admin-flow-now-line"
              stroke="var(--ui-border-strong)"
              strokeDasharray="4 5"
              x={observedUntil}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
