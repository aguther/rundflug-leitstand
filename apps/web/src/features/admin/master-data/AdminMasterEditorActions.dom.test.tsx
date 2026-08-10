// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminMasterEditorFooter,
  AdminMasterEditorFurtherActions,
  getAdminMasterEditorPresentation,
} from "./AdminMasterEditorActions";

const editors = {
  aircraft: { editorId: "aircraft-a", registration: "D-EAAA" },
  gate: { editorId: "gate-a", label: "Gate A" },
  pilot: { code: "P-01", editorId: "pilot-a" },
  product: { editorId: "product-a", name: "Panorama" },
  resourceGroup: { editorId: "group-a", name: "Panorama-Gruppe" },
};

afterEach(cleanup);

describe("admin master editor actions", () => {
  it("maps each category to its command, focus target and deletion identity", () => {
    expect(getAdminMasterEditorPresentation("gates", 1, editors)).toMatchObject({
      busyKey: "master-gate",
      initialFocusSelector: "#gate-label",
      singularLabel: "Gate",
      deleteAction: { entityId: "gate-a", entityType: "GATE", label: "Gate A" },
    });
    expect(getAdminMasterEditorPresentation("resource-groups", 1, editors)).toMatchObject({
      busyKey: "master-resource-group",
      initialFocusSelector: "#resource-name",
      deleteAction: { entityId: "group-a", entityType: "RESOURCE_GROUP" },
    });
    expect(getAdminMasterEditorPresentation("aircraft", 1, editors)).toMatchObject({
      busyKey: "master-aircraft",
      initialFocusSelector: "#aircraft-registration",
      deleteAction: { entityId: "aircraft-a", entityType: "AIRCRAFT" },
    });
    expect(getAdminMasterEditorPresentation("pilots", 1, editors)).toMatchObject({
      busyKey: "master-pilot",
      initialFocusSelector: "#pilot-operational-code",
      deleteAction: { entityId: "pilot-a", entityType: "PILOT" },
    });
    expect(getAdminMasterEditorPresentation("products", 1, editors)).toMatchObject({
      busyKey: "master-product",
      initialFocusSelector: "#product-name",
      deleteAction: { entityId: "product-a", entityType: "PRODUCT" },
    });
    expect(getAdminMasterEditorPresentation("assignments", 1, editors)).toMatchObject({
      busyKey: "master-product",
      deleteAction: null,
      initialFocusSelector: "#product-name",
      singularLabel: "Flugzeug",
    });
  });

  it("distinguishes an empty category from a filtered category", () => {
    expect(getAdminMasterEditorPresentation("products", 0, editors)).toMatchObject({
      emptyDescription: "Für diese Veranstaltung sind noch keine Einträge vorhanden.",
      emptyTitle: "Noch keine Produkte",
    });
    expect(getAdminMasterEditorPresentation("products", 3, editors)).toMatchObject({
      emptyDescription: "Die aktuelle Suche oder Filterauswahl liefert keine Einträge.",
      emptyTitle: "Keine Treffer",
    });
  });

  it("routes footer actions through their existing boundaries", () => {
    const presentation = getAdminMasterEditorPresentation("gates", 1, editors);
    const onCancel = vi.fn();
    const onDelete = vi.fn();
    const onSave = vi.fn();
    render(
      <AdminMasterEditorFooter
        administrator
        busy={false}
        deleteAction={presentation.deleteAction}
        onCancel={onCancel}
        onDelete={onDelete}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(onDelete).toHaveBeenCalledWith(presentation.deleteAction);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("keeps destructive actions disabled for a read-only session", () => {
    const presentation = getAdminMasterEditorPresentation("aircraft", 1, editors);
    render(
      <AdminMasterEditorFurtherActions
        administrator={false}
        deleteAction={presentation.deleteAction}
        onDelete={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "Löschen" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText("Eine bestehende Zuordnung muss zuerst entfernt werden.")).toBeTruthy();
  });
});
