// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PageNotice, PageNotificationRegion } from "./PageNotifications";

afterEach(() => cleanup());

describe("persistent page notification region", () => {
  it("keeps one priority lane and exposes additional persistent notices on demand", async () => {
    render(
      <PageNotificationRegion>
        <PageNotice noticeKey="critical" tone="danger">
          Kritischer Hinweis
        </PageNotice>
        <PageNotice noticeKey="update" tone="info">
          Update verfügbar
        </PageNotice>
      </PageNotificationRegion>,
    );

    const region = screen.getByRole("complementary", { name: "Dauerhafte Hinweise" });
    await waitFor(() => expect(region.hasAttribute("hidden")).toBe(false));
    const toggle = screen.getByRole("button", { name: "1 weitere Hinweise" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Kritischer Hinweis")).toBeTruthy();
    expect(screen.getByText("Update verfügbar")).toBeTruthy();
  });
});
