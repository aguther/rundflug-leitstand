// @vitest-environment jsdom

import type { EventSnapshot } from "@rundflug/contracts";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  mapEventParameters,
  useEventParametersForm,
  validateEventParameters,
} from "./useEventParametersForm";

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
  updatedAt: "2026-07-30T05:00:00.000Z",
};

describe("event parameter form", () => {
  it("maps persisted values to lossless string fields", () => {
    expect(mapEventParameters(event)).toMatchObject({
      saleOpensAt: "2026-07-30T08:00",
      operationsStartAt: "2026-07-30T09:00",
      operationsEndAt: "2026-07-30T20:00",
      plannedBufferMinutes: "3",
      automaticPrecallEnabled: true,
    });
  });

  it("keeps empty numeric inputs invalid instead of coercing them to zero", () => {
    const values = mapEventParameters(event);
    values.plannedBufferMinutes = "";
    const validation = validateEventParameters(values, event.timeZone);

    expect(validation.payload).toBeNull();
    expect(validation.errors.plannedBufferMinutes).toContain("erforderlich");
  });

  it("validates chronology, reference weights and DST gaps at field level", () => {
    const values = mapEventParameters(event);
    values.operationsStartAt = values.operationsEndAt;
    values.childReferenceWeightKg = "90";
    values.normalReferenceWeightKg = "80";
    values.saleOpensAt = "2026-03-29T02:30";
    const validation = validateEventParameters(values, event.timeZone);

    expect(validation.payload).toBeNull();
    expect(validation.errors.operationsStartAt).toContain("vor dem Betriebsende");
    expect(validation.errors.childReferenceWeightKg).toContain("unter dem Standardgewicht");
    expect(validation.errors.saleOpensAt).toContain("existiert");
  });

  it("returns the versioned command payload only for a valid form", () => {
    const validation = validateEventParameters(mapEventParameters(event), event.timeZone);

    expect(validation.errors).toEqual({});
    expect(validation.payload).toMatchObject({
      operationsEndAt: "2026-07-30T18:00:00.000Z",
      plannedBoardingMinutes: 8,
      plannedBufferMinutes: 3,
    });
  });

  it("keeps dirty values during refresh and exposes newer server versions as conflicts", () => {
    const { result, rerender } = renderHook(
      ({ currentEvent }: { currentEvent: EventSnapshot }) => useEventParametersForm(currentEvent),
      { initialProps: { currentEvent: event } },
    );

    act(() => result.current.setValue("plannedBoardingMinutes", "11"));
    expect(result.current.dirty).toBe(true);

    rerender({ currentEvent: { ...event, updatedAt: "2026-07-30T05:01:00.000Z" } });
    expect(result.current.values.plannedBoardingMinutes).toBe("11");
    expect(result.current.conflictVersion).toBeNull();

    const newer = {
      ...event,
      version: 5,
      plannedBoardingMinutes: 9,
      updatedAt: "2026-07-30T05:02:00.000Z",
    };
    rerender({ currentEvent: newer });
    expect(result.current.values.plannedBoardingMinutes).toBe("11");
    expect(result.current.conflictVersion).toBe(5);

    act(() => result.current.discard());
    expect(result.current.values.plannedBoardingMinutes).toBe("9");
    expect(result.current.dirty).toBe(false);
    expect(result.current.conflictVersion).toBeNull();
  });
});
