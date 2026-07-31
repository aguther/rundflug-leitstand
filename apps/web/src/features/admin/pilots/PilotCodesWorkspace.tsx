import type { OperationBoard } from "@rundflug/contracts";
import { Pencil, Trash2 } from "lucide-react";
import { IconButton, StatusPill } from "../../../design-system/components";
import { AdminEntityTable } from "../master-data/AdminEntityTable";

type Pilot = OperationBoard["pilots"][number];

export function PilotCodesWorkspace({
  rows,
  sortKey,
  sortDirection,
  onSort,
  onEdit,
  onDelete,
}: {
  rows: Pilot[];
  sortKey?: string | undefined;
  sortDirection?: "asc" | "desc" | null | undefined;
  onSort: (key: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, label: string) => void;
}) {
  return (
    <AdminEntityTable
      className="admin-entity-table"
      columns={[
        { key: "code", label: "Operativer Code", sortKey: "code", priority: "primary", render: (pilot) => <strong>{pilot.operationalCode}</strong> },
        { key: "note", label: "Organisatorische Bemerkung", sortKey: "note", render: (pilot) => pilot.operationalNote || "Keine Bemerkung" },
        { key: "record", label: "Stammdatenstatus", sortKey: "status", render: (pilot) => <StatusPill tone={pilot.active ? "success" : "neutral"}>{pilot.active ? "Aktiv" : "Inaktiv"}</StatusPill> },
        { key: "pause", label: "Pausenstatus", render: (pilot) => <StatusPill tone={pilot.paused ? "warning" : "neutral"}>{pilot.paused ? "Pause" : "Einsatzbereit"}</StatusPill> },
        { key: "rotation", label: "Aktuelle Fluggruppe", sortKey: "rotation", render: (pilot) => pilot.currentCommunicationNumber ? `Fluggruppe ${pilot.currentCommunicationNumber}` : "Nicht zugeordnet" },
      ]}
      onSort={onSort}
      renderRowActions={(pilot) => (
        <>
          <IconButton label={`${pilot.operationalCode} bearbeiten`} onClick={() => onEdit(pilot.id)} size="touch" type="button"><Pencil aria-hidden="true" /></IconButton>
          <IconButton className="master-row-delete" label={`${pilot.operationalCode} löschen`} onClick={() => onDelete(pilot.id, pilot.operationalCode)} size="touch" type="button"><Trash2 aria-hidden="true" /></IconButton>
        </>
      )}
      rowKey={(pilot) => pilot.id}
      rows={rows}
      sortDirection={sortDirection}
      sortKey={sortKey}
    />
  );
}
