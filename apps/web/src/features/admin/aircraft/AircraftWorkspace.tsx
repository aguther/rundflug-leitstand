import type { OperationBoard } from "@rundflug/contracts";
import { Link2, Pencil, TimerReset, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton, StatusPill } from "../../../design-system/components";
import { aircraftStateLabel } from "../../../operation-workspace";
import { AdminEntityTable } from "../master-data/AdminEntityTable";

type Aircraft = OperationBoard["aircraft"][number];

export function AircraftWorkspace({
  board,
  rows,
  sortKey,
  sortDirection,
  onSort,
  onEdit,
  onAssign,
  onTurnaround,
  onDelete,
  emptyLabel = "Keine Einträge vorhanden.",
}: Readonly<{
  board: OperationBoard;
  rows: Aircraft[];
  sortKey?: string | undefined;
  sortDirection?: "asc" | "desc" | null | undefined;
  onSort: (key: string) => void;
  onEdit: (id: string) => void;
  onAssign: (id: string, resourceGroupId: string) => void;
  onTurnaround: (id: string) => void;
  onDelete: (id: string, label: string) => void;
  emptyLabel?: ReactNode;
}>) {
  const available = board.aircraft.filter(
    (aircraft) => aircraft.operationalState === "AVAILABLE",
  ).length;
  const unassigned = board.aircraft.filter((aircraft) => !aircraft.resourceGroupId).length;
  const unavailable = board.aircraft.filter((aircraft) =>
    ["PAUSED", "INTERRUPTED", "INACTIVE"].includes(aircraft.operationalState),
  ).length;
  return (
    <>
      <section className="aircraft-workspace-summary" aria-label="Flugzeugübersicht">
        <span>
          <strong>{board.aircraft.length}</strong> gesamt
        </span>
        <span>
          <strong>{available}</strong> verfügbar
        </span>
        <span>
          <strong>{unassigned}</strong> nicht zugeordnet
        </span>
        <span>
          <strong>{unavailable}</strong> organisatorisch nicht verfügbar
        </span>
      </section>
      <AdminEntityTable
        className="admin-entity-table"
        columns={[
          {
            key: "aircraft",
            label: "Flugzeug",
            sortKey: "registration",
            priority: "primary",
            render: (aircraft) => (
              <div className="admin-entity-stacked">
                <strong>{aircraft.registration}</strong>
                <span>{aircraft.aircraftType}</span>
              </div>
            ),
          },
          {
            key: "capacity",
            label: "Kapazität",
            sortKey: "seats",
            render: (aircraft) => (
              <div className="admin-entity-stacked">
                <strong>{aircraft.passengerSeats} Plätze</strong>
                <span>
                  {aircraft.maximumPassengerPayloadKg === null
                    ? "Kein Zuladungshinweis"
                    : `${aircraft.maximumPassengerPayloadKg.toLocaleString("de-DE")} kg Hinweis`}
                </span>
              </div>
            ),
          },
          {
            key: "group",
            label: "Ressourcengruppe",
            sortKey: "group",
            render: (aircraft) => aircraft.resourceGroupName || "Nicht zugeordnet",
          },
          {
            key: "status",
            label: "Betriebsstatus",
            sortKey: "status",
            render: (aircraft) => (
              <StatusPill tone={aircraft.operationalState === "AVAILABLE" ? "success" : "neutral"}>
                {aircraftStateLabel[aircraft.operationalState]}
              </StatusPill>
            ),
          },
          {
            key: "pilot",
            label: "Pilotencode",
            render: (aircraft) => aircraft.currentPilotOperationalCode || "Nicht zugeordnet",
          },
        ]}
        emptyLabel={emptyLabel}
        onSort={onSort}
        renderRowActions={(aircraft) => (
          <>
            <IconButton
              label={`${aircraft.registration} bearbeiten`}
              onClick={() => onEdit(aircraft.id)}
              size="touch"
              type="button"
            >
              <Pencil aria-hidden="true" />
            </IconButton>
            <IconButton
              data-primary-assignment-action={aircraft.id === rows[0]?.id ? "true" : undefined}
              label={`Ressourcengruppe für ${aircraft.registration} ändern`}
              onClick={() => onAssign(aircraft.id, aircraft.resourceGroupId)}
              size="touch"
              type="button"
            >
              <Link2 aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`Bodenzeiten für ${aircraft.registration} verwalten`}
              onClick={() => onTurnaround(aircraft.id)}
              size="touch"
              type="button"
            >
              <TimerReset aria-hidden="true" />
            </IconButton>
            <IconButton
              className="master-row-delete"
              label={`${aircraft.registration} löschen`}
              onClick={() => onDelete(aircraft.id, aircraft.registration)}
              size="touch"
              type="button"
            >
              <Trash2 aria-hidden="true" />
            </IconButton>
          </>
        )}
        rowKey={(aircraft) => aircraft.id}
        rows={rows}
        sortDirection={sortDirection}
        sortKey={sortKey}
      />
    </>
  );
}
