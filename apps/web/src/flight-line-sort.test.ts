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
}: {
  id: string;
  people: number;
  product: string;
  offblock?: string;
}): TicketRow {
  return {
    group: {
      id: `group-${id}`,
      communicationNumber: Number(id),
      soldAt: `2026-07-22T08:0${id}:00.000Z`,
      ticketCount: people,
    },
    rotation: {
      id: `rotation-${id}`,
      productCode: "RN",
      productName: product,
      status: "IN_FLIGHT",
      aircraftRegistration: `D-E00${id}`,
      predictedLowerMinutes: Number(id) * 10,
      predictedUpperMinutes: Number(id) * 10 + 5,
      timeline: { actual: { departureAt: offblock } },
    },
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
