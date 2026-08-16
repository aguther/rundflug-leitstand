// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FactoryResetDialog } from "./FactoryResetDialog";

afterEach(cleanup);

describe("factory reset dialog", () => {
  it("exposes both destructive options as natively labelled checkboxes", async () => {
    const user = userEvent.setup();
    const onRetainRecoveryBackupChange = vi.fn();
    const onDeleteAllBackupsChange = vi.fn();
    render(
      <FactoryResetDialog
        busy={false}
        deleteAllBackups={false}
        error={null}
        onClose={vi.fn()}
        onDeleteAllBackupsChange={onDeleteAllBackupsChange}
        onPinChange={vi.fn()}
        onReasonChange={vi.fn()}
        onRetainRecoveryBackupChange={onRetainRecoveryBackupChange}
        onSubmit={vi.fn()}
        open
        pin=""
        reason=""
        retainRecoveryBackup
      />,
    );

    const retainedBackup = screen.getByRole("checkbox", {
      name: /Wiederherstellungssicherung in R2 behalten/,
    });
    const allBackups = screen.getByRole("checkbox", {
      name: /Auch alle R2-Sicherungen endgültig löschen/,
    });
    expect((retainedBackup as HTMLInputElement).checked).toBe(true);
    expect((allBackups as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText("Sicherheitsbestätigung")).toBeNull();

    await user.click(retainedBackup);
    await user.click(allBackups);
    expect(onRetainRecoveryBackupChange).toHaveBeenCalledWith(false);
    expect(onDeleteAllBackupsChange).toHaveBeenCalledWith(true);
  });

  it("enables the reset with only a reason and the current administrator PIN", () => {
    render(
      <FactoryResetDialog
        busy={false}
        deleteAllBackups={false}
        error={null}
        onClose={vi.fn()}
        onDeleteAllBackupsChange={vi.fn()}
        onPinChange={vi.fn()}
        onReasonChange={vi.fn()}
        onRetainRecoveryBackupChange={vi.fn()}
        onSubmit={vi.fn()}
        open
        pin="123456"
        reason="Synthetic factory reset"
        retainRecoveryBackup
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Alles löschen und neu starten",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
