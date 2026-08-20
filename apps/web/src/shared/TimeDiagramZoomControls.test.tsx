// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeDiagramZoomControls } from "./TimeDiagramZoomControls";

afterEach(cleanup);

describe("time diagram zoom controls", () => {
  it("renders exactly three icon-only zoom actions with accessible tooltips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(
      <TimeDiagramZoomControls
        onChange={onChange}
        onReset={onReset}
        value={1.5}
        zoomLevels={[1, 1.5, 2]}
      />,
    );

    const group = screen.getByRole("group", { name: "Diagramm-Zoom" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByText("Gesamt")).toBeNull();
    for (const name of [
      "Diagramm verkleinern",
      "Diagramm vergrößern",
      "Gesamten Zeitverlauf anzeigen",
    ]) {
      expect(within(group).getByRole("button", { name }).getAttribute("title")).toBe(name);
    }

    await user.click(within(group).getByRole("button", { name: "Diagramm verkleinern" }));
    await user.click(within(group).getByRole("button", { name: "Diagramm vergrößern" }));
    await user.click(within(group).getByRole("button", { name: "Gesamten Zeitverlauf anzeigen" }));
    expect(onChange.mock.calls).toEqual([[1], [2]]);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("keeps the follow action separate from the three-button zoom group", () => {
    render(
      <TimeDiagramZoomControls
        following={false}
        onChange={vi.fn()}
        onReset={vi.fn()}
        onResumeFollowing={vi.fn()}
        value={1}
        zoomLevels={[1, 1.5]}
      />,
    );

    expect(
      within(screen.getByRole("group", { name: "Diagramm-Zoom" })).getAllByRole("button"),
    ).toHaveLength(3);
    const follow = screen.getByRole("button", { name: "Aktuell folgen" });
    expect(follow.closest("fieldset")).toBeNull();
    expect(follow.textContent).toBe("");
    expect(follow.getAttribute("title")).toBe("Aktuell folgen");
  });
});
