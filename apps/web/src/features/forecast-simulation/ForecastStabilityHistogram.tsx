import { useMemo, useState } from "react";

const WIDTH = 640;
const HEIGHT = 170;
const LEFT = 42;
const RIGHT = 18;
const TOP = 18;
const BOTTOM = 30;

export function ForecastStabilityHistogram({ values }: Readonly<{ values: readonly number[] }>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const histogram = useMemo(() => {
    const maximum = Math.max(35, Math.ceil(Math.max(0, ...values) / 5) * 5);
    const binSize = 5;
    const bins = Array.from({ length: maximum / binSize }, (_, index) => ({
      from: index * binSize,
      until: (index + 1) * binSize,
      count: 0,
    }));
    for (const value of values) {
      const index = Math.min(bins.length - 1, Math.floor(value / binSize));
      const bin = bins[index];
      if (bin) bin.count += 1;
    }
    return { bins, maximum, maximumCount: Math.max(1, ...bins.map(({ count }) => count)) };
  }, [values]);
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const active = activeIndex === null ? null : histogram.bins[activeIndex];
  return (
    <div className="sim-stability-histogram-wrap">
      <svg
        aria-label="Histogramm der absoluten Boarding-Prognoseänderungen"
        className="sim-stability-histogram"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <title>
          Absolute Änderungen zwischen aufeinanderfolgenden verfügbaren DRAFT-Boardingprognosen
        </title>
        <line
          className="sim-chart-axis"
          x1={LEFT}
          x2={WIDTH - RIGHT}
          y1={TOP + plotHeight}
          y2={TOP + plotHeight}
        />
        {histogram.bins.map((bin, index) => {
          const binWidth = plotWidth / histogram.bins.length;
          const height = (bin.count / histogram.maximumCount) * plotHeight;
          return (
            // biome-ignore lint/a11y/useSemanticElements: An SVG histogram bin cannot use an HTML button element.
            <rect
              aria-label={`${bin.from} bis ${bin.until} Minuten: ${bin.count} Änderungen`}
              className="sim-stability-bin"
              data-active={activeIndex === index}
              height={height}
              key={bin.from}
              onBlur={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              role="button"
              tabIndex={0}
              width={Math.max(2, binWidth - 3)}
              x={LEFT + index * binWidth + 1.5}
              y={TOP + plotHeight - height}
            />
          );
        })}
        {[15, 30].map((threshold) => {
          const x = LEFT + (threshold / histogram.maximum) * plotWidth;
          return (
            <g className="sim-stability-threshold" key={threshold}>
              <line x1={x} x2={x} y1={TOP} y2={TOP + plotHeight} />
              <text textAnchor="middle" x={x} y={TOP - 4}>
                {threshold} Min.
              </text>
            </g>
          );
        })}
        {[0, histogram.maximum].map((tick) => (
          <text
            className="sim-chart-axis-label"
            key={tick}
            textAnchor={tick === 0 ? "start" : "end"}
            x={LEFT + (tick / histogram.maximum) * plotWidth}
            y={HEIGHT - 6}
          >
            {tick} Min.
          </text>
        ))}
        {active ? (
          <g className="sim-stability-tooltip">
            <rect
              height="26"
              rx="4"
              width="174"
              x={Math.min(
                WIDTH - 190,
                LEFT + (activeIndex ?? 0) * (plotWidth / histogram.bins.length),
              )}
              y="3"
            />
            <text
              x={
                Math.min(
                  WIDTH - 180,
                  LEFT + (activeIndex ?? 0) * (plotWidth / histogram.bins.length),
                ) + 8
              }
              y="20"
            >
              {active.from}–{active.until} Min.: {active.count}
            </text>
          </g>
        ) : null}
      </svg>
      {values.length === 0 ? (
        <p>Noch keine aufeinanderfolgenden DRAFT-Prognosen verfügbar.</p>
      ) : null}
    </div>
  );
}
