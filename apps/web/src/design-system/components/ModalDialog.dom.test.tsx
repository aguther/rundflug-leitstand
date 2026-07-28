// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalDialog } from "./ModalDialog";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("ModalDialog DOM behavior", () => {
  it("focuses its primary action, closes on Escape and restores focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const launchButton = document.createElement("button");
    launchButton.textContent = "Dialog öffnen";
    document.body.append(launchButton);
    launchButton.focus();

    const view = render(
      <ModalDialog
        footer={<button type="button">Speichern</button>}
        onClose={onClose}
        open
        title="Kontrollierter Dialog"
      >
        <p>Änderungen werden erst nach Bestätigung wirksam.</p>
      </ModalDialog>,
    );

    expect(screen.getByRole("dialog", { name: "Kontrollierter Dialog" })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getAllByRole("button", { name: "Dialog schließen" })[1],
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();

    view.rerender(
      <ModalDialog onClose={onClose} open={false} title="Kontrollierter Dialog">
        <p>Geschlossen</p>
      </ModalDialog>,
    );
    expect(document.activeElement).toBe(launchButton);
    launchButton.remove();
  });

  it("keeps keyboard focus inside the open dialog", async () => {
    const user = userEvent.setup();
    render(
      <ModalDialog
        footer={<button type="button">Letzte Aktion</button>}
        onClose={() => undefined}
        open
        title="Fokusgrenze"
      >
        <button type="button">Erste Aktion</button>
      </ModalDialog>,
    );

    const lastAction = screen.getByRole("button", { name: "Letzte Aktion" });
    lastAction.focus();
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getAllByRole("button", { name: "Dialog schließen" })[1],
    );
  });

  it("can isolate a dialog from view-specific ancestor styles", () => {
    const adminSection = document.createElement("section");
    adminSection.className = "admin-shell admin-section";
    document.body.append(adminSection);

    render(
      <ModalDialog onClose={() => undefined} open portal title="Isolierter Dialog">
        <p>Gemeinsamer Dialogstil</p>
      </ModalDialog>,
      { container: adminSection },
    );

    expect(document.querySelector(".ds-modal-backdrop")?.parentElement).toBe(document.body);
  });
});
