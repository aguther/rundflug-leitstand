// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureBoundary } from "../FeatureRouter";
import { AppErrorBoundary } from "./AppErrorBoundary";

const SENSITIVE_ERROR_DETAIL = "synthetic-ticket-token-ABCD1234";

function BrokenView(): ReactNode {
  throw new Error(SENSITIVE_ERROR_DETAIL);
}

function WorkingView() {
  return <p>Arbeitsbereich wiederhergestellt</p>;
}

function ProviderLikeWrapper({ children }: { children: ReactNode }) {
  return <div data-provider="synthetic">{children}</div>;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AP-02 application error boundary", () => {
  it("shows neutral application copy, focuses the heading, and reloads exactly once", async () => {
    const reload = vi.fn();
    const user = userEvent.setup();

    render(
      <AppErrorBoundary scope="application" reload={reload}>
        <BrokenView />
      </AppErrorBoundary>,
    );

    const heading = screen.getByRole("heading", {
      name: "Anwendung konnte nicht angezeigt werden.",
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(document.body.textContent).not.toContain(SENSITIVE_ERROR_DETAIL);
    await waitFor(() => expect(document.activeElement).toBe(heading));

    await user.click(screen.getByRole("button", { name: "Neu laden" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("catches a failure below a provider-like wrapper", () => {
    render(
      <AppErrorBoundary scope="application">
        <ProviderLikeWrapper>
          <BrokenView />
        </ProviderLikeWrapper>
      </AppErrorBoundary>,
    );

    expect(
      screen.getByRole("heading", { name: "Anwendung konnte nicht angezeigt werden." }),
    ).toBeTruthy();
  });
});

describe("AP-02 route error boundary", () => {
  it("uses route-specific copy around lazy feature content", () => {
    render(
      <FeatureBoundary routeKey="/flight-line">
        <BrokenView />
      </FeatureBoundary>,
    );

    expect(
      screen.getByRole("heading", { name: "Arbeitsbereich konnte nicht angezeigt werden." }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain(SENSITIVE_ERROR_DETAIL);
  });

  it("recovers when the route key changes", async () => {
    const rendered = render(
      <AppErrorBoundary scope="route" resetKey="/broken">
        <BrokenView />
      </AppErrorBoundary>,
    );
    expect(
      screen.getByRole("heading", { name: "Arbeitsbereich konnte nicht angezeigt werden." }),
    ).toBeTruthy();

    rendered.rerender(
      <AppErrorBoundary scope="route" resetKey="/working">
        <WorkingView />
      </AppErrorBoundary>,
    );

    expect(await screen.findByText("Arbeitsbereich wiederhergestellt")).toBeTruthy();
  });
});
