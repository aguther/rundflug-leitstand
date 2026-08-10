// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminAuthorizationDialog } from "./AdminAuthorizationDialog";

afterEach(cleanup);

describe("admin authorization dialog", () => {
  it("does not render without a pending authorization", () => {
    const { container } = render(
      <AdminAuthorizationDialog
        busy={false}
        error={null}
        inputRef={createRef<HTMLInputElement>()}
        mode={null}
        onClose={vi.fn()}
        onPinChange={vi.fn()}
        onSubmit={vi.fn()}
        pin=""
      />,
    );

    expect(container.childElementCount).toBe(0);
  });

  it("requires a complete PIN before unlocking the editing session", () => {
    const onPinChange = vi.fn();
    const onSubmit = vi.fn();
    render(
      <AdminAuthorizationDialog
        busy={false}
        error={null}
        inputRef={createRef<HTMLInputElement>()}
        mode="unlock"
        onClose={vi.fn()}
        onPinChange={onPinChange}
        onSubmit={onSubmit}
        pin="123"
      />,
    );

    expect(screen.getByRole("dialog", { name: "Bearbeitungsmodus entsperren" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Entsperren" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText("Administrator-PIN"), {
      target: { value: "1234" },
    });
    expect(onPinChange).toHaveBeenCalledWith("1234");

    const form = document.getElementById("admin-pin-form");
    if (!form) throw new Error("Expected the admin authorization form.");
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("keeps a busy single-action confirmation open and exposes its error", () => {
    const onClose = vi.fn();
    render(
      <AdminAuthorizationDialog
        busy
        error="PIN rejected"
        inputRef={createRef<HTMLInputElement>()}
        mode="action"
        onClose={onClose}
        onPinChange={vi.fn()}
        onSubmit={vi.fn()}
        pin="1234"
      />,
    );

    expect(screen.getByRole("dialog", { name: "Änderung bestätigen" })).toBeTruthy();
    expect(screen.getByText("PIN rejected")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Abbrechen" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const closeButton = screen.getAllByRole("button", { name: "Dialog schließen" })[0];
    if (!closeButton) throw new Error("Expected a dialog close action.");
    fireEvent.click(closeButton);
    expect(onClose).not.toHaveBeenCalled();
  });
});
