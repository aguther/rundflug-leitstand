import { describe, expect, it } from "vitest";
import { dispatchSegmentOrderSql } from "./dispatch-ordering-sql";

describe("split booking-group coordination", () => {
  it("orders draft segments by their stable booking segment suffix", () => {
    expect(dispatchSegmentOrderSql("candidate_rotation", "candidate_group")).toContain(
      "candidate_rotation.booking_segment_order",
    );
  });
});
