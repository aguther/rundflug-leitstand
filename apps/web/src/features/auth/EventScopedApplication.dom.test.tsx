// @vitest-environment jsdom

import type { EventCatalogEntry, OperatorSession } from "@rundflug/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventScopedApplication } from "./EventScopedApplication";

const loadSelectableEventsMock = vi.hoisted(() => vi.fn());

vi.mock("./api", () => ({
  loadSelectableEvents: loadSelectableEventsMock,
}));

vi.mock("./EventSelectionPage", () => ({
  EventSelectionPage: () => <div data-testid="event-selection">Veranstaltung auswählen</div>,
}));

vi.mock("../../FeatureRouter", () => ({
  FeatureRouter: () => (
    <div data-testid="feature-router">
      {window.localStorage.getItem("active-event-id") ?? "missing-event"}
    </div>
  ),
}));

const events: EventCatalogEntry[] = [
  {
    eventId: "e1",
    name: "Veranstaltung Eins",
    eventDate: "2026-07-11",
    aerodrome: "EDMG",
    timeZone: "Europe/Berlin",
    status: "ACTIVE",
    archivedAt: null,
    templateSourceId: null,
    version: 1,
  },
  {
    eventId: "e2",
    name: "Veranstaltung Zwei",
    eventDate: "2026-07-12",
    aerodrome: "EDMG",
    timeZone: "Europe/Berlin",
    status: "PREPARATION",
    archivedAt: null,
    templateSourceId: null,
    version: 1,
  },
];

const session = {
  authenticated: true,
  account: { id: "admin-account", loginCode: "ADMIN-01", role: "ADMIN" },
} satisfies OperatorSession;

beforeEach(() => {
  window.localStorage.clear();
  loadSelectableEventsMock.mockReset();
  loadSelectableEventsMock.mockResolvedValue({ events });
});

afterEach(() => cleanup());

describe("F-ADM-080 event-scoped application initialization", () => {
  it("activates a valid deep link before mounting the feature router and canonicalizes the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/admin?event=e1&area=events&step=aircraft&filter=Rundflug%20Nord#editor",
    );

    render(<EventScopedApplication session={session} />);

    expect((await screen.findByTestId("feature-router")).textContent).toBe("e1");
    expect(window.localStorage.getItem("active-event-id")).toBe("e1");
    expect(window.localStorage.getItem("active-event-label")).toBe("Veranstaltung Eins");
    expect(window.location.pathname).toBe("/admin");
    expect(window.location.search).toBe("?area=events&step=aircraft&filter=Rundflug+Nord");
    expect(window.location.hash).toBe("#editor");
  });

  it("keeps an invalid deep link visible and shows event selection", async () => {
    window.history.replaceState(null, "", "/admin?event=missing&area=events");
    window.localStorage.setItem("active-event-id", "e2");
    window.localStorage.setItem("active-event-label", "Veranstaltung Zwei");

    render(<EventScopedApplication session={session} />);

    expect(await screen.findByTestId("event-selection")).toBeTruthy();
    expect(window.location.search).toBe("?event=missing&area=events");
    expect(window.localStorage.getItem("active-event-id")).toBe("e2");
    expect(window.localStorage.getItem("active-event-label")).toBe("Veranstaltung Zwei");
  });

  it("uses a stored event when no deep-link parameter is present", async () => {
    window.history.replaceState(null, "", "/admin?area=users");
    window.localStorage.setItem("active-event-id", "e2");

    render(<EventScopedApplication session={session} />);

    expect((await screen.findByTestId("feature-router")).textContent).toBe("e2");
    expect(window.localStorage.getItem("active-event-id")).toBe("e2");
    expect(window.localStorage.getItem("active-event-label")).toBe("Veranstaltung Zwei");
    expect(window.location.search).toBe("?area=users");
  });

  it("shows event selection without a deep link or stored event", async () => {
    window.history.replaceState(null, "", "/admin?area=events");

    render(<EventScopedApplication session={session} />);

    expect(await screen.findByTestId("event-selection")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("feature-router")).toBeNull());
    expect(window.location.search).toBe("?area=events");
  });
});
