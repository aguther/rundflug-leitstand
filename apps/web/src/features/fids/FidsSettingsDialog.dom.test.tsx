// @vitest-environment jsdom

import type { FidsFilterOptions, FidsPreferences } from "@rundflug/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FidsSettingsDialog } from "./FidsSettingsDialog";

const preferences: FidsPreferences = {
  visibleRows: 8,
  layout: "SINGLE",
  theme: "SYSTEM",
  viewMode: "SPLIT",
  priorityGroupCount: 3,
  rotationIntervalSeconds: 12,
  groupSharedFlights: false,
  contentFilter: { productIds: [], gateIds: [] },
  version: 4,
};

const filterOptions: FidsFilterOptions = {
  products: [
    { id: "product-a", code: "PA", name: "Panorama", gateId: "gate-a", active: true },
    { id: "product-b", code: "PB", name: "Kurzflug", gateId: "gate-b", active: false },
  ],
  gates: [
    { id: "gate-a", label: "Gate A", active: true },
    { id: "gate-b", label: "Gate B", active: false },
  ],
};

afterEach(cleanup);

function renderSettings(overrides: Partial<React.ComponentProps<typeof FidsSettingsDialog>> = {}) {
  const onClose = vi.fn();
  const onLogout = vi.fn(async () => undefined);
  const onSave = vi.fn(async () => undefined);
  const onSetSetupMode = vi.fn();
  render(
    <FidsSettingsDialog
      accountCode="FIDS-01"
      departedVisibilitySeconds={90}
      eventName="Synthetischer Flugtag"
      filterOptions={filterOptions}
      filterOptionsLoaded
      onClose={onClose}
      onLogout={onLogout}
      onSave={onSave}
      onSetSetupMode={onSetSetupMode}
      open
      page={2}
      preferences={preferences}
      setupMode={false}
      {...overrides}
    />,
  );
  return { onClose, onLogout, onSave, onSetSetupMode };
}

describe("FIDS settings dialog", () => {
  it("persists layout, display and explicit content filters", async () => {
    const user = userEvent.setup();
    const { onClose, onSave } = renderSettings();

    expect(screen.getByRole("dialog", { name: "FIDS-Einstellungen" })).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: /Gruppen desselben Flugs zusammenfassen/ }),
    ).toBeTruthy();
    expect(document.querySelector(".fids-split-guidance")?.textContent).toContain(
      "Abgeflogene Gruppen bleiben 90 Sek. oben sichtbar.",
    );

    await user.click(screen.getByLabelText("Anzeigeplätze gesamt erhöhen"));
    await user.click(screen.getByLabelText("Oben reservierte Plätze erhöhen"));
    await user.click(screen.getByLabelText("Seitenwechsel unten erhöhen"));
    await user.click(screen.getByText("Zwei Spalten"));
    await user.click(screen.getByText("Dunkel"));
    await user.click(screen.getByText("Gruppen desselben Flugs zusammenfassen"));

    const products = screen.getByRole("group", { name: "Produkte" });
    await user.click(within(products).getByText("PA · Panorama"));
    const gates = screen.getByRole("group", { name: "Gates" });
    await user.click(within(gates).getByText("Gate B · inaktiv"));
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        contentFilter: { productIds: ["product-b"], gateIds: ["gate-a"] },
        groupSharedFlights: true,
        layout: "DOUBLE",
        priorityGroupCount: 4,
        rotationIntervalSeconds: 13,
        theme: "DARK",
        visibleRows: 9,
      }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open and reports a rejected save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {
      throw new Error("Synthetischer Versionskonflikt");
    });
    const { onClose } = renderSettings({ onSave });

    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Synthetischer Versionskonflikt",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("warns about stale filters and exposes setup and logout actions", async () => {
    const user = userEvent.setup();
    const stalePreferences: FidsPreferences = {
      ...preferences,
      contentFilter: { productIds: ["removed-product"], gateIds: ["removed-gate"] },
    };
    const { onClose, onLogout, onSetSetupMode } = renderSettings({
      preferences: stalePreferences,
    });

    expect(screen.getByText(/2 nicht mehr verfügbare Auswahl/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Setup aktivieren" }));
    expect(onSetSetupMode).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: /Abmelden/ }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("disables saving while filter options are still loading", () => {
    renderSettings({ filterOptions: { gates: [], products: [] }, filterOptionsLoaded: false });

    expect(screen.getAllByText("Optionen werden geladen …")).toHaveLength(2);
    expect((screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
