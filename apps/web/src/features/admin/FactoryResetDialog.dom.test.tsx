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
        confirmation=""
        deleteAllBackups={false}
        error={null}
        onClose={vi.fn()}
        onConfirmationChange={vi.fn()}
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

    await user.click(retainedBackup);
    await user.click(allBackups);
    expect(onRetainRecoveryBackupChange).toHaveBeenCalledWith(false);
    expect(onDeleteAllBackupsChange).toHaveBeenCalledWith(true);
  });
});
