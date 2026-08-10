// @vitest-environment jsdom

import type { OperationBoard } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PilotEditorDialog } from "./PilotEditorDialog";
import { usePilotEditorState } from "./usePilotEditorState";

const pilots = [
  {
    id: "pilot-a",
    operationalCode: "P-01",
    operationalNote: "Morning shift",
    active: true,
    paused: true,
    currentCommunicationNumber: 17,
  },
] as OperationBoard["pilots"];

interface HarnessProps {
  dirty?: boolean;
  onToggle?: () => void;
  selectedId?: string;
  submitAttempted?: boolean;
}

function Harness({
  dirty = false,
  onToggle = () => undefined,
  selectedId,
  submitAttempted = false,
}: HarnessProps) {
  const editor = usePilotEditorState(pilots);
  useEffect(() => {
    if (selectedId) editor.select(selectedId);
  }, [editor.select, selectedId]);

  return (
    <PilotEditorDialog
      administrator
      busy={false}
      dirty={dirty}
      editor={editor}
      footer={<button type="button">Speichern</button>}
      furtherActions={<button type="button">Weitere Aktionen</button>}
      initialFocusSelector="#pilot-operational-code"
      onClose={() => undefined}
      onToggle={onToggle}
      open
      submitAttempted={submitAttempted}
    />
  );
}

afterEach(cleanup);

describe("pilot editor dialog", () => {
  it("presents anonymous technical fields for a new pilot code", () => {
    render(<Harness />);

    expect(screen.getByRole("dialog", { name: "Pilotencode anlegen" })).toBeTruthy();
    expect(screen.getByText(/keine Namen oder Lizenzdaten/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/keine personenbezogenen Daten/)).toBeTruthy();
  });

  it("normalizes the operational code through the feature editor", () => {
    render(<Harness />);
    const code = screen.getByLabelText("Operativer Pilotencode") as HTMLInputElement;

    fireEvent.change(code, { target: { value: "p 02!" } });

    expect(code.value).toBe("P 02!");
  });

  it("shows projected pause and assignment state for an existing pilot", async () => {
    render(<Harness selectedId="pilot-a" />);

    await waitFor(() => screen.getByRole("dialog", { name: "Pilotencode bearbeiten" }));
    expect(screen.getByText("Pause")).toBeTruthy();
    expect(screen.getByText("Fluggruppe 17")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deaktivieren" })).toBeTruthy();
  });

  it("blocks a status change while the draft is dirty", async () => {
    const onToggle = vi.fn();
    render(<Harness dirty onToggle={onToggle} selectedId="pilot-a" />);

    const toggle = await waitFor(() => screen.getByRole("button", { name: "Deaktivieren" }));
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText(/Speichern oder verwerfen/)).toBeTruthy();
  });

  it("keeps invalid-code guidance inside the dialog", () => {
    render(<Harness submitAttempted />);
    fireEvent.change(screen.getByLabelText("Operativer Pilotencode"), {
      target: { value: "x" },
    });

    expect(screen.getByText(/2 bis 12 Großbuchstaben/)).toBeTruthy();
  });
});
