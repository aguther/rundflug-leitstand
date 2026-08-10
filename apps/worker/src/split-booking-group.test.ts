import { describe, expect, it } from "vitest";
import { dispatchSegmentOrderSql } from "./dispatch-ordering-sql";
import workerSource from "./index.ts?raw";

describe("split booking-group coordination", () => {
  it("orders draft segments by their stable booking segment suffix", () => {
    expect(dispatchSegmentOrderSql("candidate_rotation", "candidate_group")).toContain(
      "candidate_rotation.booking_segment_order",
    );
  });

  it("publishes total and next-segment counts without replacing legacy totals", () => {
    expect(workerSource).toContain("nextSegmentTicketCount: group.next_segment_ticket_count");
    expect(workerSource).toContain("ticketCount: group.ticket_count");
    expect(workerSource).toContain("segmentIndex: group.segment_index");
  });
});
