// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QrScanDialog, TicketPaper } from "./CashierTicketPresentation";

const ticket = {
  code: "SYNTHETIC-CODE",
  communicationLabel: "G-SYN-0042",
  eventName: "Synthetic event",
  gateLabel: "Gate A",
  groupSize: 3,
  productName: "Synthetic flight",
  qrDataUrl: "data:image/png;base64,c3ludGhldGlj",
  statusUrl: "https://example.test/status/synthetic",
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("cashier QR scan dialog", () => {
  it("marks the printed ticket code as a copy target", () => {
    render(<TicketPaper ticket={ticket} />);

    expect(screen.getByText("SYNTHETIC-CODE").classList.contains("ui-select-all")).toBe(true);
  });

  it("uses native dialog semantics for backdrop and escape interactions", () => {
    const onClose = vi.fn();
    render(<QrScanDialog onClose={onClose} open ticket={ticket} />);

    const dialog = screen.getByRole("dialog", { name: "Gruppenstatus scannen" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(screen.getByText("SYNTHETIC-CODE").classList.contains("ui-select-all")).toBe(true);
    fireEvent.click(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
