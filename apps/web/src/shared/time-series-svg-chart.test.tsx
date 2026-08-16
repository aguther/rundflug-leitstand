// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  chartLinePath,
  chartStepBandPath,
  chartTickValues,
  nearestChartPoint,
  scaleChartValue,
  TimeSeriesSvgChart,
} from "./time-series-svg-chart";

describe("time series SVG chart", () => {
  it("scales constant-safe domains and creates deterministic line paths", () => {
    expect(scaleChartValue(5, [0, 10], [10, 110])).toBe(60);
    expect(scaleChartValue(5, [5, 5], [0, 100])).toBe(0);
    expect(
      chartLinePath(
        [
          { x: 0, y: 10 },
          { x: 5, y: 20 },
          { x: 10, y: 15 },
        ],
        "linear",
      ),
    ).toBe("M0,10 L5,20 L10,15");
    expect(
      chartLinePath(
        [
          { x: 0, y: 10 },
          { x: 5, y: 20 },
        ],
        "stepAfter",
      ),
    ).toBe("M0,10 H5 V20");
    expect(chartLinePath([{ x: 5, y: 10 }], "monotone")).toBe("M5,10");
    expect(
      chartLinePath(
        [
          { x: 0, y: 0 },
          { x: 5, y: 10 },
          { x: 10, y: 5 },
        ],
        "monotone",
      ),
    ).toMatch(/^M0,0 C.* 5,10 C.* 10,5$/);
    expect(chartLinePath([], "monotone")).toBe("");
    expect(chartTickValues([0, 8], 3)).toEqual([0, 4, 8]);
    expect(chartTickValues([5, 5], 2)).toEqual([5, 6]);
  });

  it("closes the open-ticket band and rejects mismatched point sets", () => {
    expect(
      chartStepBandPath(
        [
          { x: 0, y: 10 },
          { x: 5, y: 20 },
        ],
        [
          { x: 0, y: 4 },
          { x: 5, y: 8 },
        ],
      ),
    ).toBe("M0,10 H5 V20 L5,8 V4 H0 Z");
    expect(chartStepBandPath([{ x: 0, y: 1 }], [])).toBe("");
  });

  it("finds the nearest point and renders series, axes, references, and active points", () => {
    const points = [
      { id: "first", x: 10 },
      { id: "second", x: 30 },
    ];
    expect(nearestChartPoint(points, 24)?.id).toBe("second");
    expect(nearestChartPoint([], 24)).toBeNull();

    const { container } = render(
      <TimeSeriesSvgChart
        activePoints={[{ color: "blue", id: "active", x: 10, y: 5 }]}
        className="test-chart"
        formatXTick={String}
        formatYTick={String}
        height={100}
        horizontalReferences={[{ color: "green", dash: "3 5", value: 5 }]}
        insets={{ bottom: 20, left: 20, right: 10, top: 10 }}
        series={[
          {
            color: "blue",
            curve: "linear",
            id: "line",
            label: "Line",
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 5 },
            ],
            showPoints: true,
          },
        ]}
        verticalReferences={[{ color: "orange", label: "Marker", value: 5 }]}
        width={200}
        xDomain={[0, 10]}
        xTicks={[0, 10]}
        yDomain={[0, 5]}
        yTicks={[0, 5]}
      />,
    );

    expect(container.querySelector('g[data-series="line"] path')?.getAttribute("d")).toBe(
      "M20,80 L190,10",
    );
    expect(container.querySelectorAll(".svg-chart-active-point")).toHaveLength(1);
    expect(container.querySelectorAll(".svg-chart-reference")).toHaveLength(2);
    expect(container.textContent).toContain("Marker");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("svg")?.getAttribute("role")).toBeNull();
    expect(container.querySelector("svg")?.getAttribute("tabindex")).toBeNull();
  });
});
