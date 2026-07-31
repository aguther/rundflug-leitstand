// @vitest-environment jsdom

import type { EventSnapshot } from "@rundflug/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventParametersWorkspace } from "./EventParametersWorkspace";

vi.mock("../../../design-system/BrandMark", () => ({
  BrandMark: ({ alt }: { alt: string }) => <span aria-label={alt} role="img" />,
}));

const event: EventSnapshot = {
  eventId: "synthetic-event",
  name: "Synthetischer Flugtag",
  eventDate: "2026-07-30",
  aerodrome: "EDXX",
  timeZone: "Europe/Berlin",
  status: "PREPARATION",
  archivedAt: null,
  templateSourceId: null,
  emergencyMode: false,
  operationalInterrupted: false,
  version: 4,
  operationalNote: "",
  saleOpensAt: "2026-07-30T06:00:00.000Z",
  operationsStartAt: "2026-07-30T07:00:00.000Z",
  operationsEndAt: "2026-07-30T18:00:00.000Z",
  noShowAfterMinutes: 10,
  maxTicketDeferrals: 2,
  notificationLeadMinutes: 15,
  automaticPrecallEnabled: true,
  precallLeadMinutes: 15,
  maximumGateWaitMinutes: 20,
  precallMinimumQuality: "CHANGING",
  precallGateCooldownMinutes: 2,
  referenceWeightsKg: { child: 35, normal: 80, heavy: 110 },
  plannedBoardingMinutes: 8,
  plannedDeboardingMinutes: 5,
  plannedBufferMinutes: 3,
  departedVisibilitySeconds: 15,
  logoVariants: { light: true, dark: false },
  updatedAt: "2026-07-30T05:00:00.000Z",
};

afterEach(cleanup);

function renderWorkspace(overrides: Partial<Parameters<typeof EventParametersWorkspace>[0]> = {}) {
  const onDirtyChange = vi.fn();
  const onSave = vi.fn();
  const onUploadLogo = vi.fn();
  const onRemoveLogo = vi.fn();
  render(
    <EventParametersWorkspace
      administrator
      busyActionKey={null}
      event={event}
      onDirtyChange={onDirtyChange}
      onRemoveLogo={onRemoveLogo}
      onSave={onSave}
      onUploadLogo={onUploadLogo}
      {...overrides}
    />,
  );
  return { onDirtyChange, onSave, onUploadLogo, onRemoveLogo };
}

describe("event parameters workspace", () => {
  it("keeps save disabled until a valid value changes and submits typed values", async () => {
    const user = userEvent.setup();
    const { onSave } = renderWorkspace();
    const save = screen.getByRole<HTMLButtonElement>("button", { name: "Speichern" });
    expect(save.disabled).toBe(true);

    const boarding = screen.getByRole("spinbutton", { name: "Boarding" });
    await user.clear(boarding);
    await user.type(boarding, "11");

    expect(screen.getByText("Bodenzeit 19 Min.")).not.toBeNull();
    expect(save.disabled).toBe(false);
    await user.click(save);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ plannedBoardingMinutes: 11 }),
      expect.objectContaining({
        onSaved: expect.any(Function),
        onConflict: expect.any(Function),
      }),
    );
  });

  it("switches appearance without changing the parameter dirty state", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole("tab", { name: "Darstellung" }));
    expect(screen.getByText("Logo für helles Theme")).not.toBeNull();
    expect(screen.getByText("Logo für dunkles Theme")).not.toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Speichern" }).disabled).toBe(
      true,
    );
  });

  it("requires confirmation before discarding local values", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const buffer = screen.getByRole("spinbutton", { name: "Puffer" });
    await user.clear(buffer);
    await user.type(buffer, "6");

    await user.click(screen.getAllByRole("button", { name: "Verwerfen" })[0] as HTMLElement);
    expect(
      screen.getByRole("alertdialog", { name: "Ungespeicherte Änderungen verwerfen?" }),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Änderungen verwerfen" }));
    expect((screen.getByRole("spinbutton", { name: "Puffer" }) as HTMLInputElement).value).toBe(
      "3",
    );
  });
});
