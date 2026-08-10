// @vitest-environment jsdom

import type { MasterDataTemplate, MasterDataTemplateValidation } from "@rundflug/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MasterDataDeleteTarget } from "../../../operation-workspace";
import {
  MasterDataDeleteDialog,
  MasterDataTemplateImportDialog,
} from "./MasterDataManagementDialogs";

const target: MasterDataDeleteTarget = {
  blockers: [],
  entityId: "product-a",
  entityType: "PRODUCT",
  label: "Panorama flight",
};

const validation = {
  valid: true,
  targetEligible: true,
  counts: {
    gates: 1,
    resourceGroups: 1,
    aircraft: 2,
    assignments: 2,
    pilots: 3,
    products: 1,
  },
  errors: [],
  warnings: [],
} as unknown as MasterDataTemplateValidation;

afterEach(cleanup);

describe("master data management dialogs", () => {
  it("blocks deletion after operational release", () => {
    render(
      <MasterDataDeleteDialog
        busy={false}
        eventStatus="ACTIVE"
        inputRef={createRef<HTMLInputElement>()}
        modeUnlocked
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onPinChange={vi.fn()}
        pin="1234"
        target={target}
      />,
    );

    expect(screen.getByText("Löschen ist nach Betriebsfreigabe gesperrt.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Endgültig löschen" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("explains blockers without discarding the pending target", () => {
    render(
      <MasterDataDeleteDialog
        busy={false}
        eventStatus="PREPARATION"
        inputRef={createRef<HTMLInputElement>()}
        modeUnlocked
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        onPinChange={vi.fn()}
        pin="1234"
        target={{ ...target, blockers: ["Active ticket product"] }}
      />,
    );

    expect(screen.getByText("Active ticket product")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Endgültig löschen" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("requires and forwards the PIN for an eligible deletion", () => {
    const onConfirm = vi.fn();
    const onPinChange = vi.fn();
    render(
      <MasterDataDeleteDialog
        busy={false}
        eventStatus="PREPARATION"
        inputRef={createRef<HTMLInputElement>()}
        modeUnlocked={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        onPinChange={onPinChange}
        pin="1234"
        target={target}
      />,
    );

    fireEvent.change(screen.getByLabelText("Administrator-PIN"), {
      target: { value: "5678" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    expect(onPinChange).toHaveBeenCalledWith("5678");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("enables an atomically validated template import", () => {
    const onFile = vi.fn();
    const onImport = vi.fn();
    const { container } = render(
      <MasterDataTemplateImportDialog
        busy={false}
        draft={{} as MasterDataTemplate}
        error={null}
        fileName="template.json"
        onClose={vi.fn()}
        onFile={onFile}
        onImport={onImport}
        open
        validation={validation}
      />,
    );

    expect(screen.getByText("template.json")).toBeTruthy();
    expect(screen.getByText(/Die Vorlage ist gültig/)).toBeTruthy();
    const file = new File(["{}"], "template.json", { type: "application/json" });
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) throw new Error("Expected the template file input.");
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Importieren" }));
    expect(onFile).toHaveBeenCalledWith(file);
    expect(onImport).toHaveBeenCalledOnce();
  });

  it("keeps invalid template feedback in the import dialog", () => {
    render(
      <MasterDataTemplateImportDialog
        busy={false}
        draft={{} as MasterDataTemplate}
        error="Invalid JSON"
        fileName=""
        onClose={vi.fn()}
        onFile={vi.fn()}
        onImport={vi.fn()}
        open
        validation={{ ...validation, valid: false, targetEligible: false }}
      />,
    );

    expect(screen.getByText("Invalid JSON")).toBeTruthy();
    expect(screen.getByText(/Das Ziel muss leer und im Status Vorbereitung sein/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Importieren" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
