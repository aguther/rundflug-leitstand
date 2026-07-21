import { describe, expect, it } from "vitest";
import coordinatorSource from "./event-coordinator.ts?raw";
import workerSource from "./index.ts?raw";

describe("split booking-group coordination", () => {
  it("selects only the earliest remaining draft segment for CALL_NEXT", () => {
    expect(coordinatorSource).toContain("candidate_rotation.status = 'DRAFT'");
    expect(coordinatorSource).toContain("candidate_group.communication_number");
    expect(coordinatorSource).toContain("ORDER BY COALESCE(candidate_group.queue_position");
    expect(coordinatorSource).toContain("LIMIT 1");
  });

  it("moves only tickets from the selected source segment", () => {
    expect(coordinatorSource).toContain("moved_assignment.rotation_id = ?3");
    expect(coordinatorSource).toContain("moved_ticket.ticket_group_id = ?4");
    expect(coordinatorSource).not.toContain(
      "SELECT ?1, id, ?2 FROM tickets WHERE ticket_group_id = ?3`",
    );
  });

  it("keeps a group queue-visible while another draft segment remains", () => {
    const draftBranch = coordinatorSource.indexOf("segment_rotation.status = 'DRAFT'");
    const calledBranch = coordinatorSource.indexOf(
      "segment_rotation.status = 'CALLED'",
      draftBranch,
    );
    expect(draftBranch).toBeGreaterThan(0);
    expect(calledBranch).toBeGreaterThan(draftBranch);
    expect(coordinatorSource).toContain("THEN 'PRESENT' ELSE 'QUEUED' END");
  });

  it("publishes total and next-segment counts without replacing legacy totals", () => {
    expect(workerSource).toContain("JOIN next_draft_segments next_segment");
    expect(workerSource).not.toContain("(SELECT queued_segment.ticket_count");
    expect(workerSource).toContain("next_segment_ticket_count");
    expect(workerSource).toContain("nextSegmentTicketCount: group.next_segment_ticket_count");
    expect(workerSource).toContain("ticketCount: group.ticket_count");
    expect(workerSource).toContain("segmentIndex: group.segment_index");
  });
});
