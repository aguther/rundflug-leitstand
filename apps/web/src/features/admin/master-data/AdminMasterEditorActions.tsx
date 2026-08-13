import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../../design-system/components";
import type { MasterEditorDeleteAction } from "./admin-master-editor-presentation";

export {
  getAdminMasterEditorPresentation,
  type MasterEditorDeleteAction,
  type MasterEditorIdentities,
} from "./admin-master-editor-presentation";

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
