import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventSelectionLocation,
  reloadAtEventSelectionLocation,
  switchActiveEvent,
} from "./event-navigation";

const absoluteUrl = (location: string) => `https://leitstand.example${location}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F-ADM-080 event navigation", () => {
  it.each([
    ["/admin?event=e1", "/admin"],
    ["/admin?event=e1&area=events&step=products", "/admin?area=events&step=products"],
    ["/admin?area=users&event=e1", "/admin?area=users"],
    ["/kasse", "/kasse"],
    ["/fids?event=e1#display", "/fids#display"],
  ])("removes only the event parameter from %s", (location, expected) => {
    expect(eventSelectionLocation(absoluteUrl(location))).toBe(expected);
  });

  it("preserves encoded, unknown parameters and the hash", () => {
    const location = eventSelectionLocation(
      absoluteUrl("/admin?event=e1&filter=Rundflug%20Nord&mode=%C3%A4#aircraft"),
    );
    const normalized = new URL(location, "https://leitstand.example");

    expect(normalized.searchParams.get("filter")).toBe("Rundflug Nord");
    expect(normalized.searchParams.get("mode")).toBe("ä");
    expect(normalized.searchParams.has("event")).toBe(false);
    expect(normalized.hash).toBe("#aircraft");
  });

  it("replaces the current history entry before reloading it", () => {
    const replaceState = vi.fn();
    const reload = vi.fn();

    reloadAtEventSelectionLocation(
      {
        href: absoluteUrl("/admin?event=e1&area=events&step=products#editor"),
        reload,
      },
      { replaceState },
    );

    expect(replaceState).toHaveBeenCalledWith(null, "", "/admin?area=events&step=products#editor");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("forgets both active-event keys before reloading the cleaned location", () => {
    const removeItem = vi.fn();
    const replaceState = vi.fn();
    const reload = vi.fn();
    vi.stubGlobal("window", {
      localStorage: { removeItem },
      history: { replaceState },
      location: {
        href: absoluteUrl("/admin?event=e1&area=events&step=products#editor"),
        reload,
      },
    });

    switchActiveEvent();

    expect(removeItem.mock.calls).toEqual([["active-event-id"], ["active-event-label"]]);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/admin?area=events&step=products#editor");
    expect(reload).toHaveBeenCalledOnce();
  });
});
