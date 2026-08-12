import type { OperationBoard } from "@rundflug/contracts";
import { Link2, Pencil, Trash2 } from "lucide-react";
import { IconButton, StatusPill } from "../../../design-system/components";

type ResourceGroup = OperationBoard["resourceGroups"][number];

const statusLabels: Record<ResourceGroup["status"], string> = {
  ACTIVE: "Aktiv",
  PAUSED: "Pausiert",
  INTERRUPTED: "Unterbrochen",
  ENDED: "Beendet",
};

function statusTone(status: ResourceGroup["status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "ENDED") return "neutral";
  return status === "INTERRUPTED" ? "danger" : "warning";
}

function CompactRelationshipList({ values }: Readonly<{ values: string[] }>) {
  if (values.length === 0) return <span className="resource-card-empty-value">Keine</span>;
  const visible = values.slice(0, 3);
  return (
    <div className="resource-card-chip-list">
      {visible.map((value) => (
        <span key={value}>{value}</span>
      ))}
      {values.length > visible.length ? (
        <span>+ {values.length - visible.length} weitere</span>
      ) : null}
    </div>
  );
}

export function ResourceGroupsWorkspace({
  board,
  rows,
  onEdit,
  onAssign,
  onDelete,
}: Readonly<{
  board: OperationBoard;
  rows: ResourceGroup[];
  onEdit: (id: string) => void;
  onAssign: (id: string) => void;
  onDelete: (id: string, label: string) => void;
}>) {
  return (
    <div className="resource-group-card-grid" data-testid="resource-group-card-grid">
      {rows.map((group) => {
        const aircraft = group.activeAircraftIds.map(
          (id) => board.aircraft.find((entry) => entry.id === id)?.registration ?? id,
        );
        const products = board.products
          .filter((product) => product.resourceGroupId === group.id)
          .map((product) => product.code);
        return (
          <article className="resource-group-card" key={group.id}>
            <header>
              <div>
                <strong>{group.name}</strong>
                <span>{group.shortCode}</span>
              </div>
              <StatusPill tone={statusTone(group.status)}>{statusLabels[group.status]}</StatusPill>
            </header>
            <dl>
              <div>
                <dt>Gate</dt>
                <dd>{group.gateLabel}</dd>
              </div>
              <div>
                <dt>Kapazität</dt>
                <dd>{group.referenceCapacity} Plätze</dd>
              </div>
              <div>
                <dt>Voraufruf</dt>
                <dd>{group.automaticPrecallEnabled ? "Automatisch" : "Manuell"}</dd>
              </div>
            </dl>
            <div className="resource-card-relationships">
              <div>
                <span>Produkte</span>
                <CompactRelationshipList values={products} />
              </div>
              <div>
                <span>Flugzeuge</span>
                <CompactRelationshipList values={aircraft} />
              </div>
            </div>
            <footer>
              <IconButton
                label={`${group.name} bearbeiten`}
                onClick={() => onEdit(group.id)}
                size="touch"
                type="button"
              >
                <Pencil aria-hidden="true" />
              </IconButton>
              <IconButton
                label={`Flugzeug ${group.name} zuordnen`}
                onClick={() => onAssign(group.id)}
                size="touch"
                type="button"
              >
                <Link2 aria-hidden="true" />
              </IconButton>
              <IconButton
                className="master-row-delete"
                label={`${group.name} löschen`}
                onClick={() => onDelete(group.id, group.name)}
                size="touch"
                type="button"
              >
                <Trash2 aria-hidden="true" />
              </IconButton>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
