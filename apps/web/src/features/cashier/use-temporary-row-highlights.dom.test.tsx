// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "../../design-system/components";
import { useTemporaryRowHighlights } from "./use-temporary-row-highlights";

function HighlightHarness({ visibleIds }: { visibleIds: string[] }) {
  const highlights = useTemporaryRowHighlights(visibleIds);
  const rows = visibleIds.map((id) => ({ id, label: `Gruppe ${id}` }));
  return (
    <>
      <button onClick={() => highlights.queueHighlight("one")} type="button">
        Eins vormerken
      </button>
      <button onClick={() => highlights.queueHighlight("two")} type="button">
        Zwei vormerken
      </button>
      <DataTable
        columns={[{ key: "label", header: "Gruppe", render: (row) => row.label }]}
        rowClassName={(row) => (highlights.highlightedIds.has(row.id) ? "recent" : undefined)}
        rowKey={(row) => row.id}
        rows={rows}
        selectedRowKey="one"
      />
    </>
  );
}

describe("temporary cashier row highlights", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts only when the queued row becomes visible and survives reordering", () => {
    const { rerender } = render(<HighlightHarness visibleIds={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Eins vormerken" }));
    expect(vi.getTimerCount()).toBe(0);

    rerender(<HighlightHarness visibleIds={["one", "two"]} />);
    expect(screen.getByText("Gruppe one").closest("tr")?.className).toContain("recent");
    expect(screen.getByText("Gruppe one").closest("tr")?.className).toContain("selected");

    rerender(<HighlightHarness visibleIds={["two", "one"]} />);
    expect(screen.getByText("Gruppe one").closest("tr")?.className).toContain("recent");
  });

  it("expires multiple rows on independent ten-second timers without extension", () => {
    render(<HighlightHarness visibleIds={["one", "two"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Eins vormerken" }));
    act(() => vi.advanceTimersByTime(5_000));
    fireEvent.click(screen.getByRole("button", { name: "Eins vormerken" }));
    fireEvent.click(screen.getByRole("button", { name: "Zwei vormerken" }));

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText("Gruppe one").closest("tr")?.className).not.toContain("recent");
    expect(screen.getByText("Gruppe two").closest("tr")?.className).toContain("recent");

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText("Gruppe two").closest("tr")?.className).not.toContain("recent");
  });

  it("clears every active timer on unmount", () => {
    const { unmount } = render(<HighlightHarness visibleIds={["one", "two"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Eins vormerken" }));
    fireEvent.click(screen.getByRole("button", { name: "Zwei vormerken" }));
    expect(vi.getTimerCount()).toBe(2);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
