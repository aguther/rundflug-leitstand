// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs } from "./Tabs";

afterEach(() => cleanup());

describe("Tabs DOM behavior", () => {
  it("links every tab to a stable panel id", () => {
    render(
      <Tabs
        idPrefix="admin-history"
        items={[
          { value: "overview", label: "Übersicht" },
          { value: "audit", label: "Audit" },
        ]}
        label="Historie"
        onChange={() => undefined}
        value="overview"
      />,
    );

    const overview = screen.getByRole("tab", { name: "Übersicht" });
    expect(overview.id).toBe("admin-history-overview-tab");
    expect(overview.getAttribute("aria-controls")).toBe("admin-history-overview-panel");
    expect(overview.getAttribute("tabindex")).toBe("0");
  });

  it("activates and focuses tabs with arrows, Home and End", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Tabs
        items={[
          { value: "one", label: "Eins" },
          { value: "two", label: "Zwei" },
          { value: "three", label: "Drei" },
        ]}
        label="Schritte"
        onChange={onChange}
        value="two"
      />,
    );

    const active = screen.getByRole("tab", { name: "Zwei" });
    active.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("three");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Drei" }));

    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("one");
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("three");
  });
});
