import type { OperationBoard } from "@rundflug/contracts";
import { Handbag, Pencil, TimerReset, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton, StatusPill } from "../../../design-system/components";
import { AdminEntityTable } from "../master-data/AdminEntityTable";

type Product = OperationBoard["products"][number];

export function ProductsWorkspace({
  rows,
  sortKey,
  sortDirection,
  onSort,
  onEdit,
  onSales,
  onTurnaround,
  onDelete,
  emptyLabel = "Keine Einträge vorhanden.",
}: {
  rows: Product[];
  sortKey?: string | undefined;
  sortDirection?: "asc" | "desc" | null | undefined;
  onSort: (key: string) => void;
  onEdit: (id: string) => void;
  onSales: (id: string) => void;
  onTurnaround: (id: string) => void;
  onDelete: (id: string, label: string) => void;
  emptyLabel?: ReactNode;
}) {
  return (
    <AdminEntityTable
      className="admin-entity-table product-entity-table"
      columns={[
        {
          key: "product",
          label: "Produkt",
          sortKey: "code",
          priority: "primary",
          render: (product) => (
            <div className="admin-entity-stacked">
              <strong>
                {product.code} · {product.name}
              </strong>
              <span>{product.publicDescription || "Keine öffentliche Beschreibung"}</span>
            </div>
          ),
        },
        {
          key: "assignment",
          label: "Zuordnung",
          sortKey: "group",
          render: (product) => (
            <div className="admin-entity-stacked">
              <strong>{product.resourceGroupName}</strong>
              <span>{product.gateLabel}</span>
            </div>
          ),
        },
        {
          key: "price",
          label: "Preis",
          sortKey: "price",
          align: "right",
          render: (product) =>
            (product.priceCents / 100).toLocaleString("de-DE", {
              style: "currency",
              currency: "EUR",
            }),
        },
        {
          key: "time",
          label: "Zeitmodell",
          sortKey: "duration",
          render: (product) => (
            <div className="admin-entity-stacked">
              <strong>{product.promisedFlightMinutes} Min. Flug</strong>
              <span>
                {product.referenceDurationMinutes +
                  product.effectiveTurnaroundProfile.totalGroundMinutes}{" "}
                Min. Gesamtumlauf
              </span>
            </div>
          ),
        },
        {
          key: "sale",
          label: "Verkauf",
          sortKey: "status",
          render: (product) => (
            <StatusPill tone={product.saleEnabled ? "success" : "neutral"}>
              {product.saleEnabled ? "Aktiv" : "Gesperrt"}
            </StatusPill>
          ),
        },
      ]}
      emptyLabel={emptyLabel}
      onSort={onSort}
      renderRowActions={(product) => (
        <>
          <IconButton
            label={`${product.name} bearbeiten`}
            onClick={() => onEdit(product.id)}
            size="touch"
            type="button"
          >
            <Pencil aria-hidden="true" />
          </IconButton>
          <IconButton
            label={`Verkauf für ${product.name} steuern`}
            onClick={() => onSales(product.id)}
            size="touch"
            type="button"
          >
            <Handbag aria-hidden="true" />
          </IconButton>
          <IconButton
            label={`Bodenzeiten für ${product.name} verwalten`}
            onClick={() => onTurnaround(product.id)}
            size="touch"
            type="button"
          >
            <TimerReset aria-hidden="true" />
          </IconButton>
          <IconButton
            className="master-row-delete"
            label={`${product.name} löschen`}
            onClick={() => onDelete(product.id, product.name)}
            size="touch"
            type="button"
          >
            <Trash2 aria-hidden="true" />
          </IconButton>
        </>
      )}
      rowKey={(product) => product.id}
      rows={rows}
      sortDirection={sortDirection}
      sortKey={sortKey}
    />
  );
}
