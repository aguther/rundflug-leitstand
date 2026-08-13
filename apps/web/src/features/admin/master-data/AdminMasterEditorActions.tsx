import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { MasterDataCategory } from "../../../admin-ux";
import { Button } from "../../../design-system/components";
import type { MasterDataDeleteTarget } from "../../../operation-workspace";

export interface MasterEditorDeleteAction {
  description: string;
  entityId: string;
  entityType: MasterDataDeleteTarget["entityType"];
  label: string;
}

interface MasterEditorIdentities {
  aircraft: { editorId: string; registration: string };
  gate: { editorId: string; label: string };
  pilot: { code: string; editorId: string };
  product: { editorId: string; name: string };
  resourceGroup: { editorId: string; name: string };
}

const singularLabels: Record<MasterDataCategory, string> = {
  gates: "Gate",
  "resource-groups": "Ressourcengruppe",
  aircraft: "Flugzeug",
  assignments: "Flugzeug",
  pilots: "Pilotencode",
  products: "Produkt",
};

const pluralLabels: Record<MasterDataCategory, string> = {
  gates: "Gates",
  "resource-groups": "Ressourcengruppen",
  aircraft: "Flugzeuge",
  assignments: "Flugzeuge",
  pilots: "Pilotencodes",
  products: "Produkte",
};

const busyKeys: Record<MasterDataCategory, string> = {
  gates: "master-gate",
  "resource-groups": "master-resource-group",
  aircraft: "master-aircraft",
  assignments: "master-product",
  pilots: "master-pilot",
  products: "master-product",
};

const initialFocusSelectors: Record<MasterDataCategory, string> = {
  gates: "#gate-label",
  "resource-groups": "#resource-name",
  aircraft: "#aircraft-registration",
  assignments: "#product-name",
  pilots: "#pilot-operational-code",
  products: "#product-name",
};

function existingEditorDeleteAction(
  category: MasterDataCategory,
  editors: MasterEditorIdentities,
): MasterEditorDeleteAction | null {
  switch (category) {
    case "gates":
      if (editors.gate.editorId === "new") return null;
      return {
        entityType: "GATE",
        entityId: editors.gate.editorId,
        label: editors.gate.label,
        description: "Nur in der Vorbereitung und ohne operative Verwendung möglich.",
      };
    case "resource-groups":
      if (editors.resourceGroup.editorId === "new") return null;
      return {
        entityType: "RESOURCE_GROUP",
        entityId: editors.resourceGroup.editorId,
        label: editors.resourceGroup.name,
        description: "Produkte und Flugzeugzuordnungen müssen vorher entfernt sein.",
      };
    case "aircraft":
      if (editors.aircraft.editorId === "new") return null;
      return {
        entityType: "AIRCRAFT",
        entityId: editors.aircraft.editorId,
        label: editors.aircraft.registration,
        description: "Eine bestehende Zuordnung muss zuerst entfernt werden.",
      };
    case "pilots":
      if (editors.pilot.editorId === "new") return null;
      return {
        entityType: "PILOT",
        entityId: editors.pilot.editorId,
        label: editors.pilot.code,
        description: "Nur ohne Umlauf oder Flugzeugbindung möglich.",
      };
    case "products":
      if (editors.product.editorId === "new") return null;
      return {
        entityType: "PRODUCT",
        entityId: editors.product.editorId,
        label: editors.product.name,
        description: "Nur ohne Tickets oder Umläufe möglich.",
      };
    default:
      return null;
  }
}

export function getAdminMasterEditorPresentation(
  category: MasterDataCategory,
  totalCount: number,
  editors: MasterEditorIdentities,
) {
  const deleteAction = existingEditorDeleteAction(category, editors);

  return {
    busyKey: busyKeys[category],
    deleteAction,
    emptyDescription:
      totalCount === 0
        ? "Für diese Veranstaltung sind noch keine Einträge vorhanden."
        : "Die aktuelle Suche oder Filterauswahl liefert keine Einträge.",
    emptyTitle: totalCount === 0 ? `Noch keine ${pluralLabels[category]}` : "Keine Treffer",
    initialFocusSelector: initialFocusSelectors[category],
    singularLabel: singularLabels[category],
  };
}

interface AdminMasterEditorActionProps {
  administrator: boolean;
  busy: boolean;
  deleteAction: MasterEditorDeleteAction | null;
  onCancel: () => void;
  onDelete: (action: MasterEditorDeleteAction) => void;
  onSave: () => void;
}

export function AdminMasterEditorFooter({
  administrator,
  busy,
  deleteAction,
  onCancel,
  onDelete,
  onSave,
}: Readonly<AdminMasterEditorActionProps>): ReactNode {
  return (
    <>
      {deleteAction ? (
        <Button
          className="master-editor-delete-footer"
          disabled={!administrator}
          onClick={() => onDelete(deleteAction)}
          type="button"
          variant="danger"
        >
          <Trash2 aria-hidden="true" />
          Löschen
        </Button>
      ) : null}
      <div className="master-editor-standard-actions">
        <Button onClick={onCancel} type="button">
          Abbrechen
        </Button>
        <Button
          busy={busy}
          disabled={!administrator}
          onClick={onSave}
          type="button"
          variant="primary"
        >
          Speichern
        </Button>
      </div>
    </>
  );
}

export function AdminMasterEditorFurtherActions({
  administrator,
  deleteAction,
  onDelete,
}: Readonly<Pick<AdminMasterEditorActionProps, "administrator" | "deleteAction" | "onDelete">>) {
  if (!deleteAction) return null;
  return (
    <section className="master-editor-more-actions">
      <h3>Weitere Aktionen</h3>
      <p>{deleteAction.description}</p>
      <Button
        disabled={!administrator}
        onClick={() => onDelete(deleteAction)}
        type="button"
        variant="danger"
      >
        <Trash2 aria-hidden="true" />
        Löschen
      </Button>
    </section>
  );
}
