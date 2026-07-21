import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import appShellSource from "./app/AppShell.tsx?raw";
import noticesSource from "./app/PageNotifications.tsx?raw";
import cashierSource from "./cashier-view.tsx?raw";
import flightLineSource from "./flight-line-view.tsx?raw";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("cross-surface page notifications", () => {
  it("renders top-level messages in a fixed overlay that cannot shift page layout", () => {
    expect(appShellSource).toContain("PageNotificationRegion");
    expect(cashierSource).toContain("notifications={");
    expect(flightLineSource).toContain("notifications={");
    expect(styles).toMatch(/\.page-notification-region \{[\s\S]*?position: fixed;/);
    expect(styles).toMatch(/\.page-notification-region \{[\s\S]*?pointer-events: none;/);
  });

  it("lets operators dismiss each message while a changed key becomes visible again", () => {
    expect(noticesSource).toContain("dismissedKey === noticeKey");
    expect(noticesSource).toContain('aria-label="Meldung schließen"');
    expect(noticesSource).toContain("setDismissedKey(noticeKey)");
  });
});
