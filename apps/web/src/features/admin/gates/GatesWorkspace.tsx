import type { OperationBoard } from "@rundflug/contracts";
import { Pencil, Trash2 } from "lucide-react";
import { IconButton, StatusPill } from "../../../design-system/components";
import { AdminEntityTable } from "../master-data/AdminEntityTable";

type Gate = OperationBoard["gates"][number];

const gatePhaseLabels: Record<string, string> = {
  DRAFT: "Geplant",
  CALLED: "Aufgerufen",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
  CANCELED: "Storniert",
};

function compactList(values: string[], limit = 2): string {
  if (values.length === 0) return "Keine";
  const visible = values.slice(0, limit);
  const remaining = values.length - visible.length;
  return remaining > 0 ? `${visible.join(", ")} · +${remaining}` : visible.join(", ");
}

export function GatesWorkspace({
  board,
  rows,
  sortKey,
  sortDirection,
  onSort,
  onEdit,
  onDelete,
}: {
  board: OperationBoard;
  rows: Gate[];
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
        {
          key: "gate",
          label: "Gate",
          sortKey: "label",
          priority: "primary",
          render: (gate) => (
            <div className="admin-entity-primary gate-primary-cell">
              <strong>{gate.label}</strong>
              <StatusPill tone={gate.active ? "success" : "neutral"}>
                {gate.active ? "Aktiv" : "Inaktiv"}
              </StatusPill>
            </div>
          ),
        },
        {
          key: "groups",
          label: "Ressourcengruppen",
          render: (gate) =>
            compactList(
              board.resourceGroups
                .filter((group) => group.gateId === gate.id)
                .map((group) => group.name),
            ),
        },
        {
          key: "display",
          label: "Öffentliche Anzeige",
          render: (gate) => {
            const productIds = gate.displayFilter.productIds;
            if (productIds.length === 0) return "Alle Produkte";
            return compactList(
              productIds.map(
                (id) => board.products.find((product) => product.id === id)?.code ?? id,
              ),
            );
          },
        },
        {
          key: "phases",
          label: "Sichtbare Phasen",
          render: (gate) => {
            const statuses = gate.displayFilter.rotationStatuses;
            return statuses.length === 0
              ? "Alle Phasen"
              : compactList(
                  statuses.map((status) => gatePhaseLabels[status] ?? status),
                  3,
                );
          },
        },
        {
          key: "order",
          label: "Reihenfolge",
          sortKey: "sortOrder",
          align: "right",
          render: (gate) => gate.sortOrder,
        },
      ]}
      onSort={onSort}
      renderRowActions={(gate) => (
        <>
          <IconButton
            label={`${gate.label} bearbeiten`}
            onClick={() => onEdit(gate.id)}
            size="touch"
            type="button"
          >
            <Pencil aria-hidden="true" />
          </IconButton>
          <IconButton
            className="master-row-delete"
            label={`${gate.label} löschen`}
            onClick={() => onDelete(gate.id, gate.label)}
            size="touch"
            type="button"
          >
            <Trash2 aria-hidden="true" />
          </IconButton>
        </>
      )}
      rowKey={(gate) => gate.id}
      rows={rows}
      sortDirection={sortDirection}
      sortKey={sortKey}
    />
  );
}
