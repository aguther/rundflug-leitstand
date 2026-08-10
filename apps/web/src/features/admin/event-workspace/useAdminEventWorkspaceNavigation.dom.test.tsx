// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SetupStep } from "../../../admin-ux";
import { useAdminEventWorkspaceNavigation } from "./useAdminEventWorkspaceNavigation";

function renderNavigation(url: string, onStepSelected?: (step: SetupStep) => void) {
  window.history.replaceState(null, "", url);
  const initialParams = new URLSearchParams(window.location.search);
  return renderHook(() =>
    useAdminEventWorkspaceNavigation({
      initialParams,
      ...(onStepSelected ? { onStepSelected } : {}),
    }),
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("admin event workspace navigation", () => {
  it.each([
    ["/admin?area=events&step=operations", "events", "operations"],
    ["/admin?area=audit", "events", "completion"],
    ["/admin?area=master-data&section=assignments", "events", "aircraft"],
    ["/admin?area=master-data&section=products", "events", "products"],
    ["/admin?area=unknown", "overview", "event"],
  ])("resolves current and legacy URL state for %s", (url, area, step) => {
    const view = renderNavigation(url);

    expect(view.result.current.adminArea).toBe(area);
    expect(view.result.current.eventStep).toBe(step);
    expect(window.location.search).toContain(`area=${area}`);
    if (area === "events") expect(window.location.search).toContain(`step=${step}`);
    expect(window.location.search).not.toContain("section=");
  });

  it("navigates immediately while the event form is clean", () => {
    const view = renderNavigation("/admin?area=events&step=event");

    act(() => view.result.current.changeAdminArea("users"));

    expect(view.result.current.adminArea).toBe("users");
    expect(view.result.current.discardEventNavigationOpen).toBe(false);
    expect(window.location.search).toBe("?area=users");
  });

  it("resets the independent workspace scroller after navigation", () => {
    const view = renderNavigation("/admin?area=events&step=event");
    const scrollTo = vi.fn();
    Object.defineProperty(view.result.current.adminWorkspaceScrollRef, "current", {
      configurable: true,
      value: { scrollTo },
    });

    act(() => view.result.current.changeAdminArea("users"));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  it("defers navigation until dirty event parameters are confirmed", () => {
    const onStepSelected = vi.fn();
    const view = renderNavigation("/admin?area=events&step=event", onStepSelected);
    const gatesStep: SetupStep = { id: "gates", label: "Gates", complete: false };

    act(() => view.result.current.setEventParametersDirty(true));
    act(() => view.result.current.openSetupStep(gatesStep));

    expect(view.result.current.eventStep).toBe("event");
    expect(view.result.current.discardEventNavigationOpen).toBe(true);
    expect(onStepSelected).not.toHaveBeenCalled();

    act(() => view.result.current.confirmPendingNavigation());

    expect(view.result.current.eventStep).toBe("gates");
    expect(view.result.current.eventParametersDirty).toBe(false);
    expect(view.result.current.eventParametersResetKey).toBe(1);
    expect(view.result.current.discardEventNavigationOpen).toBe(false);
    expect(onStepSelected).toHaveBeenCalledWith(gatesStep);
  });

  it("keeps the current view when dirty navigation is cancelled", () => {
    const view = renderNavigation("/admin?area=events&step=event");

    act(() => view.result.current.setEventParametersDirty(true));
    act(() => view.result.current.changeAdminArea("backup"));
    act(() => view.result.current.cancelPendingNavigation());

    expect(view.result.current.adminArea).toBe("events");
    expect(view.result.current.eventParametersDirty).toBe(true);
    expect(view.result.current.eventParametersResetKey).toBe(0);
    expect(view.result.current.discardEventNavigationOpen).toBe(false);
  });

  it("registers the browser unload guard only while parameters are dirty", () => {
    const view = renderNavigation("/admin?area=events&step=event");
    const cleanEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    act(() => view.result.current.setEventParametersDirty(true));
    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    act(() => view.result.current.setEventParametersDirty(false));
    const savedEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(savedEvent);
    expect(savedEvent.defaultPrevented).toBe(false);
  });
});
