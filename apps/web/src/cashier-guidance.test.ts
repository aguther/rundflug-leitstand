import { describe, expect, it } from "vitest";
import {
  cashierTicketCompletionIndicator,
  requiresChildCompanionWarning,
} from "./cashier-guidance";

describe("child companion guidance", () => {
  it("warns for a configured group containing only children", () => {
    expect(requiresChildCompanionWarning(true, ["CHILD"])).toBe(true);
    expect(requiresChildCompanionWarning(true, ["CHILD", "CHILD"])).toBe(true);
  });

  it("does not warn when the group contains a non-child companion", () => {
    expect(requiresChildCompanionWarning(true, ["CHILD", "NORMAL"])).toBe(false);
    expect(requiresChildCompanionWarning(true, ["CHILD", "INDIVIDUAL"])).toBe(false);
  });

  it("does not infer children when the feature or class is not active", () => {
    expect(requiresChildCompanionWarning(false, ["CHILD"])).toBe(false);
    expect(requiresChildCompanionWarning(true, ["NORMAL", "HEAVY"])).toBe(false);
    expect(requiresChildCompanionWarning(true, ["NOT_CAPTURED"])).toBe(false);
  });
});

describe("cashier ticket completion indicator", () => {
  it("stays empty before boarding starts", () => {
    expect(cashierTicketCompletionIndicator("QUEUED", [])).toBe("NONE");
    expect(cashierTicketCompletionIndicator("QUEUED", ["DRAFT", "DRAFT"])).toBe("NONE");
  });

  it("shows progress after boarding starts", () => {
    expect(cashierTicketCompletionIndicator("CALLED", ["CALLED"])).toBe("IN_PROGRESS");
    expect(cashierTicketCompletionIndicator("IN_FLIGHT", ["IN_FLIGHT"])).toBe("IN_PROGRESS");
    expect(cashierTicketCompletionIndicator("LANDED", ["LANDED"])).toBe("IN_PROGRESS");
  });

  it("keeps split groups in progress until every rotation is completed", () => {
    expect(cashierTicketCompletionIndicator("QUEUED", ["COMPLETED", "DRAFT"])).toBe("IN_PROGRESS");
  });

  it("shows completion only when every rotation is completed", () => {
    expect(cashierTicketCompletionIndicator("COMPLETED", ["COMPLETED"])).toBe("COMPLETED");
    expect(cashierTicketCompletionIndicator("COMPLETED", ["COMPLETED", "COMPLETED"])).toBe(
      "COMPLETED",
    );
  });

  it("does not show operational completion for canceled tickets", () => {
    expect(cashierTicketCompletionIndicator("CANCELED", ["COMPLETED"])).toBe("NONE");
  });
});
