// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ForecastStabilityHistogram } from "./ForecastStabilityHistogram";

afterEach(cleanup);

describe("ForecastStabilityHistogram", () => {
  it("renders 15/30-minute thresholds and reveals bin details on focus", () => {
    render(<ForecastStabilityHistogram values={[1, 3, 8, 17, 34]} />);

    expect(screen.getByText("15 Min.")).toBeTruthy();
    expect(screen.getByText("30 Min.")).toBeTruthy();
    const bin = screen.getByRole("button", { name: "15 bis 20 Minuten: 1 Änderungen" });
    fireEvent.focus(bin);
    expect(screen.getByText("15–20 Min.: 1")).toBeTruthy();
    fireEvent.blur(bin);
    expect(screen.queryByText("15–20 Min.: 1")).toBeNull();
  });
});
