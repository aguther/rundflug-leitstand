// @vitest-environment jsdom

import type { AdminEventFlow } from "@rundflug/contracts";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminEventFlow } from "./useAdminEventFlow";

const mocks = vi.hoisted(() => ({ getAdminEventFlow: vi.fn() }));

vi.mock("../../../api", () => mocks);

const flow = { tickets: [], totals: {} } as unknown as AdminEventFlow;

afterEach(() => {
  vi.clearAllMocks();
});

describe("admin event flow state", () => {
  it("loads only for an active administrator overview", async () => {
    mocks.getAdminEventFlow.mockResolvedValue(flow);
    const { result, rerender } = renderHook(
      ({ active }) => useAdminEventFlow({ active, administrator: true, eventVersion: 8 }),
      { initialProps: { active: false } },
    );

    expect(mocks.getAdminEventFlow).not.toHaveBeenCalled();
    rerender({ active: true });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.flow).toBe(flow);
    expect(result.current.error).toBeNull();
  });

  it("retains a readable loading failure", async () => {
    mocks.getAdminEventFlow.mockRejectedValue(new Error("Synthetic flow failure"));
    const { result } = renderHook(() =>
      useAdminEventFlow({ active: true, administrator: true, eventVersion: 8 }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Synthetic flow failure");
  });

  it("does not load without an event version or administrator access", () => {
    renderHook(() =>
      useAdminEventFlow({ active: true, administrator: false, eventVersion: undefined }),
    );

    expect(mocks.getAdminEventFlow).not.toHaveBeenCalled();
  });
});
