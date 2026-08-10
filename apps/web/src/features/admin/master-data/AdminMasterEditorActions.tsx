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

export function getAdminMasterEditorPresentation(
  category: MasterDataCategory,
  totalCount: number,
  editors: MasterEditorIdentities,
) {
  const deleteAction: MasterEditorDeleteAction | null =
    category === "gates" && editors.gate.editorId !== "new"
      ? {
          entityType: "GATE",
          entityId: editors.gate.editorId,
          label: editors.gate.label,
          description: "Nur in der Vorbereitung und ohne operative Verwendung möglich.",
        }
      : category === "resource-groups" && editors.resourceGroup.editorId !== "new"
        ? {
            entityType: "RESOURCE_GROUP",
            entityId: editors.resourceGroup.editorId,
            label: editors.resourceGroup.name,
            description: "Produkte und Flugzeugzuordnungen müssen vorher entfernt sein.",
          }
        : category === "aircraft" && editors.aircraft.editorId !== "new"
          ? {
              entityType: "AIRCRAFT",
              entityId: editors.aircraft.editorId,
              label: editors.aircraft.registration,
              description: "Eine bestehende Zuordnung muss zuerst entfernt werden.",
            }
          : category === "pilots" && editors.pilot.editorId !== "new"
            ? {
                entityType: "PILOT",
                entityId: editors.pilot.editorId,
                label: editors.pilot.code,
                description: "Nur ohne Umlauf oder Flugzeugbindung möglich.",
              }
            : category === "products" && editors.product.editorId !== "new"
              ? {
                  entityType: "PRODUCT",
                  entityId: editors.product.editorId,
                  label: editors.product.name,
                  description: "Nur ohne Tickets oder Umläufe möglich.",
                }
              : null;

  return {
    busyKey:
      category === "gates"
        ? "master-gate"
        : category === "resource-groups"
          ? "master-resource-group"
          : category === "aircraft"
            ? "master-aircraft"
            : category === "pilots"
              ? "master-pilot"
              : "master-product",
    deleteAction,
    emptyDescription:
      totalCount === 0
        ? "Für diese Veranstaltung sind noch keine Einträge vorhanden."
        : "Die aktuelle Suche oder Filterauswahl liefert keine Einträge.",
    emptyTitle: totalCount === 0 ? `Noch keine ${pluralLabels[category]}` : "Keine Treffer",
    initialFocusSelector:
      category === "gates"
        ? "#gate-label"
        : category === "resource-groups"
          ? "#resource-name"
          : category === "aircraft"
            ? "#aircraft-registration"
            : category === "pilots"
              ? "#pilot-operational-code"
              : "#product-name",
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
}: AdminMasterEditorActionProps): ReactNode {
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
}: Pick<AdminMasterEditorActionProps, "administrator" | "deleteAction" | "onDelete">) {
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
