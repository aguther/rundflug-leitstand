// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";
import { applyInitialTheme, ThemeProvider, useTheme } from "./theme";

const media = {
  addEventListener: vi.fn(),
  matches: false,
  removeEventListener: vi.fn(),
};

function ThemeProbe() {
  const theme = useTheme();
  return (
    <div>
      <output>{`${theme.preference}/${theme.resolved}/${theme.system}`}</output>
      <button onClick={() => theme.setPreference("dark")} type="button">
        Direkt dunkel
      </button>
      <ThemeToggle />
      <ThemeToggle binary />
    </div>
  );
}

describe("theme contracts", () => {
  beforeEach(() => {
    window.localStorage.clear();
    media.addEventListener.mockReset();
    media.removeEventListener.mockReset();
    media.matches = false;
    window.matchMedia = vi.fn().mockReturnValue(media);
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-preference");
    document.documentElement.removeAttribute("style");
    document.head.innerHTML = '<meta name="theme-color" content="#000000">';
  });

  afterEach(() => cleanup());

  it("applies valid stored and system preferences during startup", () => {
    window.localStorage.setItem("ui-theme", "dark");
    applyInitialTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      "#121c2a",
    );

    window.localStorage.setItem("ui-theme", "invalid");
    media.matches = true;
    applyInitialTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("system");
  });

  it("cycles preferences, persists explicit choices, and reacts to system changes", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(screen.getByText("system/light/light")).toBeTruthy();
    expect(window.localStorage.getItem("ui-theme")).toBeNull();
    expect(document.querySelector('svg[data-theme-icon="system"]')).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Systemdarstellung aktiv. Zu Hell wechseln" }),
    );
    expect(screen.getByText("light/light/light")).toBeTruthy();
    expect(window.localStorage.getItem("ui-theme")).toBe("light");
    expect(document.querySelector('svg[data-theme-icon="sun"]')).not.toBeNull();
    const [cycleToggle] = screen.getAllByRole("button", {
      name: "Helle Darstellung aktiv. Zu Dunkel wechseln",
    });
    expect(cycleToggle).toBeDefined();
    if (!cycleToggle) return;
    await user.click(cycleToggle);
    expect(screen.getByText("dark/dark/light")).toBeTruthy();
    expect(document.querySelector('svg[data-theme-icon="moon"]')).not.toBeNull();
    await user.click(
      screen.getByRole("button", {
        name: "Dunkle Darstellung aktiv. Zur Systemdarstellung wechseln",
      }),
    );
    expect(screen.getByText("system/light/light")).toBeTruthy();

    const change = media.addEventListener.mock.calls.find(([name]) => name === "change")?.[1] as
      | (() => void)
      | undefined;
    media.matches = true;
    act(() => change?.());
    expect(await screen.findByText("system/dark/dark")).toBeTruthy();
  });

  it("supports direct and binary theme selection and removes media listeners", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("ui-theme", "light");
    const view = render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Direkt dunkel" }));
    expect(screen.getByText("dark/dark/light")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Dunkle Darstellung aktiv. Zu Hell wechseln" }),
    );
    expect(screen.getByText("light/light/light")).toBeTruthy();
    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("requires a provider for theme consumers", () => {
    expect(() => render(<ThemeToggle />)).toThrow("useTheme must be used inside ThemeProvider");
  });
});
