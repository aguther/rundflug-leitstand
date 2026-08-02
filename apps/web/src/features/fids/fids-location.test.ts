import { describe, expect, it, vi } from "vitest";
import { createFidsLocationAdapter } from "./fids-location";

function locationWindow(href: string): Window {
  const target = new EventTarget() as Window;
  const location = { href } as Location;
  Object.defineProperty(target, "location", { value: location });
  Object.defineProperty(target, "history", {
    value: {
      pushState: vi.fn((_state, _unused, next: URL) => {
        location.href = next.toString();
      }),
    },
  });
  return target;
}

describe("FIDS URL state", () => {
  it("defaults invalid pages and keeps page and setup out of persistence", () => {
    for (const value of ["0", "-2", "1.5", "text", "1000"]) {
      expect(
        createFidsLocationAdapter(
          locationWindow(`https://example.test/fids?page=${value}`),
        ).getPage(),
      ).toBe(1);
    }
  });

  it("updates history without reload and copies a setup-free, token-free URL", () => {
    const target = locationWindow(
      "https://example.test/fids?event=event-1&page=2&setup=1&gateId=legacy&gate=legacy&token=secret&unknown=secret",
    );
    const adapter = createFidsLocationAdapter(target);
    adapter.setPage(3);
    adapter.setSetupMode(false);
    expect(target.history.pushState).toHaveBeenCalledTimes(2);
    expect(adapter.getPage()).toBe(3);
    expect(adapter.isSetupMode()).toBe(false);
    expect(adapter.getShareableUrl()).toBe("https://example.test/fids?event=event-1&page=3");
  });

  it("writes the implicit first page explicitly into a copied display URL", () => {
    const adapter = createFidsLocationAdapter(
      locationWindow("https://example.test/fids?event=event-1&setup=1"),
    );
    expect(adapter.getShareableUrl()).toBe("https://example.test/fids?event=event-1&page=1");
  });
});
