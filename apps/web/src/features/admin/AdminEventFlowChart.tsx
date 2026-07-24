import type { AdminEventFlow } from "@rundflug/contracts";

const WIDTH = 960;
const HEIGHT = 320;
const PADDING = { top: 26, right: 28, bottom: 44, left: 52 };

function coordinates(
  flow: AdminEventFlow,
  value: (point: AdminEventFlow["points"][number]) => number,
  maximum: number,
): Array<[number, number]> {
  const from = Date.parse(flow.from);
  const until = Date.parse(flow.plannedUntil);
  const span = Math.max(1, until - from);
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
  return flow.points.map((point) => [
    PADDING.left + ((Date.parse(point.at) - from) / span) * innerWidth,
    PADDING.top + innerHeight - (value(point) / maximum) * innerHeight,
  ]);
}

function path(points: ReadonlyArray<readonly [number, number]>): string {
  return points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

function hourLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AdminEventFlowChart({
  error,
  flow,
  loading,
  timeZone,
}: {
  error: string | null;
  flow: AdminEventFlow | null;
  loading: boolean;
  timeZone: string;
}) {
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
  if (!flow || error) {
    return (
      <section className="admin-flow-panel">
        <div className="admin-flow-heading">
          <div>
            <h2>Verkauf und Abarbeitung</h2>
            <p>{error ?? "Für diese Veranstaltung liegen noch keine Verlaufsdaten vor."}</p>
          </div>
        </div>
      </section>
    );
  }

  const maximum = Math.max(1, ...flow.points.map((point) => point.soldTickets));
  const sold = coordinates(flow, (point) => point.soldTickets, maximum);
  const completed = coordinates(flow, (point) => point.completedTickets, maximum);
  const area = [...sold, ...completed.toReversed()]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const finalPoint = flow.points.at(-1);
  const yTicks = [...new Set([0, Math.ceil(maximum / 2), maximum])].sort((a, b) => a - b);
  const xTicks = [flow.from, flow.observedUntil, flow.plannedUntil];

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
          <span className="open">Offen: {finalPoint?.openTickets ?? 0}</span>
        </fieldset>
      </div>
      <svg
        aria-label={`Ticketverlauf: ${finalPoint?.soldTickets ?? 0} verkauft, ${finalPoint?.completedTickets ?? 0} abgeschlossen, ${finalPoint?.openTickets ?? 0} offen.`}
        className="admin-flow-chart"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        {yTicks.map((tick) => {
          const y =
            PADDING.top +
            (HEIGHT - PADDING.top - PADDING.bottom) -
            (tick / maximum) * (HEIGHT - PADDING.top - PADDING.bottom);
          return (
            <g key={tick}>
              <line
                className="admin-flow-grid-line"
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y}
                y2={y}
              />
              <text className="admin-flow-axis-label" x={PADDING.left - 10} y={y + 4}>
                {tick}
              </text>
            </g>
          );
        })}
        {xTicks.map((tick, index) => {
          const from = Date.parse(flow.from);
          const span = Math.max(1, Date.parse(flow.plannedUntil) - from);
          const x =
            PADDING.left +
            ((Date.parse(tick) - from) / span) * (WIDTH - PADDING.left - PADDING.right);
          return (
            <text
              className="admin-flow-axis-label"
              key={tick}
              textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}
              x={x}
              y={HEIGHT - 16}
            >
              {hourLabel(tick, timeZone)}
            </text>
          );
        })}
        {area ? <polygon className="admin-flow-open-area" points={area} /> : null}
        <path className="admin-flow-line sold" d={path(sold)} />
        <path className="admin-flow-line completed" d={path(completed)} />
        {sold.at(-1) ? (
          <line
            className="admin-flow-now-line"
            x1={sold.at(-1)?.[0]}
            x2={sold.at(-1)?.[0]}
            y1={PADDING.top}
            y2={HEIGHT - PADDING.bottom}
          />
        ) : null}
      </svg>
    </section>
  );
}
