export interface SvgChartPoint {
  x: number;
  y: number;
}

export type SvgChartCurve = "linear" | "monotone" | "stepAfter";

export interface SvgChartSeries {
  color: string;
  curve: SvgChartCurve;
  id: string;
  label: string;
  points: readonly SvgChartPoint[];
  showPoints?: boolean;
  strokeWidth?: number;
}

export interface SvgChartReferenceLine {
  color: string;
  dash?: string;
  label?: string;
  value: number;
}

export interface SvgChartActivePoint {
  color: string;
  id: string;
  radius?: number;
  x: number;
  y: number;
}

export interface SvgChartInsets {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface SvgChartAreaBand {
  color: string;
  lower: readonly SvgChartPoint[];
  upper: readonly SvgChartPoint[];
}

interface TimeSeriesSvgChartProps {
  activePoints?: readonly SvgChartActivePoint[];
  areaBand?: SvgChartAreaBand;
  className?: string;
  formatXTick: (value: number) => string;
  formatYTick: (value: number) => string;
  height: number;
  horizontalReferences?: readonly SvgChartReferenceLine[];
  insets: SvgChartInsets;
  series: readonly SvgChartSeries[];
  verticalReferences?: readonly SvgChartReferenceLine[];
  width: number;
  xDomain: readonly [number, number];
  xTicks: readonly number[];
  yDomain: readonly [number, number];
  yTicks: readonly number[];
}

const round = (value: number): number => Math.round(value * 100) / 100;

function normalizeDomain(domain: readonly [number, number]): readonly [number, number] {
  const minimum = Number.isFinite(domain[0]) ? domain[0] : 0;
  const maximum = Number.isFinite(domain[1]) ? domain[1] : minimum + 1;
  return maximum > minimum ? [minimum, maximum] : [minimum, minimum + 1];
}

export function scaleChartValue(
  value: number,
  domain: readonly [number, number],
  range: readonly [number, number],
): number {
  const [domainMinimum, domainMaximum] = normalizeDomain(domain);
  const ratio = (value - domainMinimum) / (domainMaximum - domainMinimum);
  return range[0] + ratio * (range[1] - range[0]);
}

function sortedUniquePoints(points: readonly SvgChartPoint[]): SvgChartPoint[] {
  const sorted = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .toSorted((left, right) => left.x - right.x);
  return sorted.filter((point, index) => index === 0 || point.x !== sorted[index - 1]?.x);
}

function linearPath(points: readonly SvgChartPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)},${round(point.y)}`)
    .join(" ");
}

function stepAfterPath(points: readonly SvgChartPoint[]): string {
  const first = points[0];
  if (!first) return "";
  const commands = [`M${round(first.x)},${round(first.y)}`];
  for (const point of points.slice(1)) {
    commands.push(`H${round(point.x)}`, `V${round(point.y)}`);
  }
  return commands.join(" ");
}

function monotoneTangents(points: readonly SvgChartPoint[]): number[] {
  if (points.length < 2) return [0];
  const slopes = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1] ?? point;
    return (next.y - point.y) / Math.max(Number.EPSILON, next.x - point.x);
  });
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0] ?? 0;
    if (index === points.length - 1) return slopes.at(-1) ?? 0;
    const before = slopes[index - 1] ?? 0;
    const after = slopes[index] ?? 0;
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index] ?? 0;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const beforeRatio = (tangents[index] ?? 0) / slope;
    const afterRatio = (tangents[index + 1] ?? 0) / slope;
    const magnitude = Math.hypot(beforeRatio, afterRatio);
    if (magnitude <= 3) continue;
    const scale = 3 / magnitude;
    tangents[index] = scale * beforeRatio * slope;
    tangents[index + 1] = scale * afterRatio * slope;
  }
  return tangents;
}

function monotonePath(points: readonly SvgChartPoint[]): string {
  const first = points[0];
  if (!first) return "";
  if (points.length === 1) return `M${round(first.x)},${round(first.y)}`;
  const tangents = monotoneTangents(points);
  const commands = [`M${round(first.x)},${round(first.y)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    if (!point || !next) continue;
    const width = next.x - point.x;
    commands.push(
      `C${round(point.x + width / 3)},${round(point.y + ((tangents[index] ?? 0) * width) / 3)} ${round(next.x - width / 3)},${round(next.y - ((tangents[index + 1] ?? 0) * width) / 3)} ${round(next.x)},${round(next.y)}`,
    );
  }
  return commands.join(" ");
}

export function chartLinePath(inputPoints: readonly SvgChartPoint[], curve: SvgChartCurve): string {
  const points = sortedUniquePoints(inputPoints);
  if (curve === "stepAfter") return stepAfterPath(points);
  if (curve === "monotone") return monotonePath(points);
  return linearPath(points);
}

export function chartStepBandPath(
  upperInput: readonly SvgChartPoint[],
  lowerInput: readonly SvgChartPoint[],
): string {
  const upper = sortedUniquePoints(upperInput);
  const lower = sortedUniquePoints(lowerInput);
  if (upper.length === 0 || lower.length === 0 || upper.length !== lower.length) return "";
  const upperPath = stepAfterPath(upper);
  const reversedLower = lower.toReversed();
  const lowerCommands: string[] = [];
  const firstLower = reversedLower[0];
  if (!firstLower) return "";
  lowerCommands.push(`L${round(firstLower.x)},${round(firstLower.y)}`);
  for (const point of reversedLower.slice(1)) {
    lowerCommands.push(`V${round(point.y)}`, `H${round(point.x)}`);
  }
  return `${upperPath} ${lowerCommands.join(" ")} Z`;
}

export function chartTickValues(domain: readonly [number, number], count = 5): number[] {
  const [minimum, maximum] = normalizeDomain(domain);
  const step = (maximum - minimum) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, index) => minimum + index * step);
}

export function nearestChartPoint<T extends { x: number }>(
  points: readonly T[],
  x: number,
): T | null {
  let nearest: T | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const nextDistance = Math.abs(point.x - x);
    if (nextDistance >= distance) continue;
    nearest = point;
    distance = nextDistance;
  }
  return nearest;
}

export function TimeSeriesSvgChart({
  activePoints = [],
  areaBand,
  className,
  formatXTick,
  formatYTick,
  height,
  horizontalReferences = [],
  insets,
  series,
  verticalReferences = [],
  width,
  xDomain,
  xTicks,
  yDomain,
  yTicks,
}: Readonly<TimeSeriesSvgChartProps>) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const plotLeft = insets.left;
  const plotRight = Math.max(plotLeft + 1, safeWidth - insets.right);
  const plotTop = insets.top;
  const plotBottom = Math.max(plotTop + 1, safeHeight - insets.bottom);
  const scaleX = (value: number) => scaleChartValue(value, xDomain, [plotLeft, plotRight]);
  const scaleY = (value: number) => scaleChartValue(value, yDomain, [plotBottom, plotTop]);
  const mapPoints = (points: readonly SvgChartPoint[]) =>
    points.map((point) => ({ x: scaleX(point.x), y: scaleY(point.y) }));
  const effectiveYTicks = yTicks.length > 0 ? yTicks : chartTickValues(yDomain);

  return (
    <svg
      aria-hidden="true"
      className={className}
      height="100%"
      preserveAspectRatio="none"
      viewBox={`0 0 ${safeWidth} ${safeHeight}`}
      width="100%"
    >
      <g className="svg-chart-grid">
        {effectiveYTicks.map((tick) => (
          <line
            key={`grid-${tick}`}
            stroke="var(--ui-border)"
            strokeDasharray="2 4"
            x1={plotLeft}
            x2={plotRight}
            y1={scaleY(tick)}
            y2={scaleY(tick)}
          />
        ))}
      </g>
      {areaBand ? (
        <path
          className="svg-chart-area"
          d={chartStepBandPath(mapPoints(areaBand.upper), mapPoints(areaBand.lower))}
          fill={areaBand.color}
        />
      ) : null}
      {horizontalReferences.map((reference) => {
        const y = scaleY(reference.value);
        return (
          <line
            className="svg-chart-reference horizontal"
            key={`horizontal-${reference.value}-${reference.color}`}
            stroke={reference.color}
            strokeDasharray={reference.dash}
            x1={plotLeft}
            x2={plotRight}
            y1={y}
            y2={y}
          />
        );
      })}
      {verticalReferences.map((reference) => {
        const x = scaleX(reference.value);
        return (
          <g key={`vertical-${reference.value}-${reference.color}`}>
            <line
              className="svg-chart-reference vertical"
              stroke={reference.color}
              strokeDasharray={reference.dash}
              x1={x}
              x2={x}
              y1={plotTop}
              y2={plotBottom}
            />
            {reference.label ? (
              <text
                className="svg-chart-reference-label"
                fill="var(--ui-muted)"
                fontSize="10"
                textAnchor="middle"
                x={x}
                y={Math.max(10, plotTop - 5)}
              >
                {reference.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {series.map((item) => {
        const points = mapPoints(item.points);
        return (
          <g data-series={item.id} key={item.id}>
            <path
              className="svg-chart-line"
              d={chartLinePath(points, item.curve)}
              fill="none"
              stroke={item.color}
              strokeWidth={item.strokeWidth ?? 1.75}
              vectorEffect="non-scaling-stroke"
            />
            {item.showPoints
              ? points.map((point) => (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    fill={item.color}
                    key={`${item.id}-${point.x}-${point.y}`}
                    r="2"
                    vectorEffect="non-scaling-stroke"
                  />
                ))
              : null}
          </g>
        );
      })}
      {activePoints.map((point) => (
        <circle
          className="svg-chart-active-point"
          cx={scaleX(point.x)}
          cy={scaleY(point.y)}
          fill="var(--ui-surface-raised)"
          key={point.id}
          r={point.radius ?? 4.5}
          stroke={point.color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <g className="svg-chart-axis x-axis">
        <line
          stroke="var(--ui-border-strong)"
          x1={plotLeft}
          x2={plotRight}
          y1={plotBottom}
          y2={plotBottom}
        />
        {xTicks.map((tick) => (
          <g key={`x-${tick}`} transform={`translate(${scaleX(tick)} ${plotBottom})`}>
            <line stroke="var(--ui-border-strong)" y2="5" />
            <text fill="var(--ui-muted)" fontSize="11" textAnchor="middle" y="17">
              {formatXTick(tick)}
            </text>
          </g>
        ))}
      </g>
      <g className="svg-chart-axis y-axis">
        <line
          stroke="var(--ui-border-strong)"
          x1={plotLeft}
          x2={plotLeft}
          y1={plotTop}
          y2={plotBottom}
        />
        {effectiveYTicks.map((tick) => (
          <g key={`y-${tick}`} transform={`translate(${plotLeft} ${scaleY(tick)})`}>
            <line stroke="var(--ui-border-strong)" x2="-5" />
            <text
              dominantBaseline="middle"
              fill="var(--ui-muted)"
              fontSize="11"
              textAnchor="end"
              x="-8"
            >
              {formatYTick(tick)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
