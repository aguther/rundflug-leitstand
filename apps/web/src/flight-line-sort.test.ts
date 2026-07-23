import { describe, expect, it } from "vitest";
import {
  compareTicketRows,
  nextTicketSort,
  type TicketRow,
  type TicketSortKey,
} from "./flight-line-supervisor";

function row({
  id,
  people,
  product,
  offblock,
  communicationNumber,
  productCode = "RN",
  flightGroupNumber,
  goToGate = false,
  queue = null,
}: {
  id: string;
  people: number;
  product: string;
  offblock?: string;
  communicationNumber?: number;
  productCode?: string;
  flightGroupNumber?: number;
  goToGate?: boolean;
  queue?: TicketRow["queue"];
}): TicketRow {
  return {
    group: {
      id: `group-${id}`,
      communicationNumber: communicationNumber ?? Number(id),
      soldAt: `2026-07-22T08:0${id}:00.000Z`,
      ticketCount: people,
    },
    rotation: {
      id: `rotation-${id}`,
      communicationNumber: flightGroupNumber ?? Number(id),
      productCode,
      productName: product,
      status: "IN_FLIGHT",
      aircraftRegistration: `D-E00${id}`,
      predictedLowerMinutes: Number(id) * 10,
      predictedUpperMinutes: Number(id) * 10 + 5,
      precalledAt: goToGate ? "2026-07-22T08:00:00.000Z" : null,
      timeline: { actual: { departureAt: offblock } },
    },
    queue,
  } as TicketRow;
}

describe("sold ticket sorting", () => {
  it("cycles each column through ascending, descending and default order", () => {
    const key: TicketSortKey = "people";
    const ascending = nextTicketSort(null, key);
    expect(ascending).toEqual({ key, direction: "ascending" });
    const descending = nextTicketSort(ascending, key);
    expect(descending).toEqual({ key, direction: "descending" });
    expect(nextTicketSort(descending, key)).toBeNull();
  });

  it("sorts numeric, localized text and actual timestamps", () => {
    const first = row({
      id: "1",
      people: 1,
      product: "Ältester-Rundflug",
      offblock: "2026-07-22T08:05:00.000Z",
    });
    const second = row({
      id: "2",
      people: 12,
      product: "Zeppelin-Rundflug",
      offblock: "2026-07-22T08:20:00.000Z",
    });
    expect(
      compareTicketRows(first, second, { key: "people", direction: "ascending" }),
    ).toBeLessThan(0);
    expect(
      compareTicketRows(first, second, { key: "product", direction: "ascending" }),
    ).toBeLessThan(0);
    expect(
      compareTicketRows(first, second, { key: "offblock", direction: "ascending" }),
    ).toBeLessThan(0);
  });

  it("sorts the separate flight-group and GoToGate-Aktiv columns", () => {
    const inactive = row({
      id: "1",
      people: 2,
      product: "Panorama",
      flightGroupNumber: 104,
    });
    const active = row({
      id: "2",
      people: 2,
      product: "Panorama",
      flightGroupNumber: 103,
      goToGate: true,
    });
    active.rotation.status = "DRAFT";
    inactive.rotation.status = "DRAFT";
    expect(
      compareTicketRows(active, inactive, { key: "flightGroup", direction: "ascending" }),
    ).toBeLessThan(0);
    expect(
      compareTicketRows(inactive, active, { key: "goToGate", direction: "ascending" }),
    ).toBeLessThan(0);
  });

  it("sorts ticket groups by communication number without the product prefix", () => {
    const lowerNumber = row({
      id: "1",
      communicationNumber: 2,
      people: 1,
      product: "Rundflug",
      productCode: "ZZ",
    });
    const higherNumber = row({
      id: "2",
      communicationNumber: 10,
      people: 1,
      product: "Rundflug",
      productCode: "AA",
    });
    expect(
      compareTicketRows(lowerNumber, higherNumber, {
        key: "ticketGroup",
        direction: "ascending",
      }),
    ).toBeLessThan(0);
  });

  it("sorts current queue positions by resource group and sequence", () => {
    const first = row({
      id: "1",
      people: 1,
      product: "Rundflug",
      queue: { resourceGroupName: "Panorama", sequence: 2 },
    });
    const later = row({
      id: "2",
      people: 1,
      product: "Rundflug",
      queue: { resourceGroupName: "Panorama", sequence: 10 },
    });
    const noLongerQueued = row({ id: "3", people: 1, product: "Rundflug" });
    expect(compareTicketRows(first, later, { key: "queue", direction: "ascending" })).toBeLessThan(
      0,
    );
    expect(
      compareTicketRows(noLongerQueued, later, { key: "queue", direction: "descending" }),
    ).toBeGreaterThan(0);
  });

  it("keeps missing values at the end in both directions", () => {
    const dated = row({
      id: "1",
      people: 1,
      product: "Rundflug",
      offblock: "2026-07-22T08:05:00.000Z",
    });
    const missing = row({ id: "2", people: 2, product: "Rundflug" });
    expect(
      compareTicketRows(missing, dated, { key: "offblock", direction: "ascending" }),
    ).toBeGreaterThan(0);
    expect(
      compareTicketRows(missing, dated, { key: "offblock", direction: "descending" }),
    ).toBeGreaterThan(0);

    const olderMissing = row({ id: "1", people: 1, product: "Rundflug" });
    expect(
      compareTicketRows(missing, olderMissing, { key: "offblock", direction: "ascending" }),
    ).toBeLessThan(0);
  });
});
