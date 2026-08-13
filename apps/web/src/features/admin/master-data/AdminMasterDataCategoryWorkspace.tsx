import type { MasterDataCategory } from "../../../admin-ux";
import { AircraftWorkspace } from "../aircraft/AircraftWorkspace";
import { GatesWorkspace } from "../gates/GatesWorkspace";
import { PilotCodesWorkspace } from "../pilots/PilotCodesWorkspace";
import { ProductsWorkspace } from "../products/ProductsWorkspace";
import { ResourceGroupsWorkspace } from "../resource-groups/ResourceGroupsWorkspace";
import type { AdminMasterDataWorkspacePanelProps } from "./AdminMasterDataWorkspacePanel";
import type { useAdminMasterDataTable } from "./useAdminMasterDataTable";

type MasterDataTableState = ReturnType<typeof useAdminMasterDataTable>;

function categorySort(table: MasterDataTableState, category: MasterDataCategory) {
  if (table.sort.category !== category) return { direction: null, key: undefined };
  return { direction: table.sort.direction, key: table.sort.key };
}

export function CategoryWorkspace({
  board,
  category,
  emptyState,
  onDelete,
  onEdit,
  onOpenAssignment,
  onOpenSales,
  onOpenTurnaround,
  table,
}: Readonly<
  Pick<
    AdminMasterDataWorkspacePanelProps,
    | "board"
    | "category"
    | "emptyState"
    | "onDelete"
    | "onEdit"
    | "onOpenAssignment"
    | "onOpenSales"
    | "onOpenTurnaround"
    | "table"
  >
>) {
  if (category === "gates") {
    const sort = categorySort(table, category);
    return (
      <GatesWorkspace
        board={board}
        emptyLabel={emptyState}
        onDelete={(id, label) => onDelete("GATE", id, label)}
        onEdit={onEdit.gates}
        onSort={table.toggleSort}
        rows={table.pagedGates}
        sortDirection={sort.direction}
        sortKey={sort.key}
      />
    );
  }
  if (category === "resource-groups") {
    return (
      <>
        <ResourceGroupsWorkspace
          board={board}
          onAssign={(resourceGroupId) =>
            onOpenAssignment({ mode: "resource-group", resourceGroupId })
          }
          onDelete={(id, label) => onDelete("RESOURCE_GROUP", id, label)}
          onEdit={onEdit.resourceGroups}
          rows={table.pagedResourceGroups}
        />
        {table.filteredCount === 0 ? emptyState : null}
      </>
    );
  }
  if (category === "aircraft") {
    const sort = categorySort(table, category);
    return (
      <AircraftWorkspace
        board={board}
        emptyLabel={emptyState}
        onAssign={(aircraftId) => onOpenAssignment({ mode: "aircraft", aircraftId })}
        onDelete={(id, label) => onDelete("AIRCRAFT", id, label)}
        onEdit={onEdit.aircraft}
        onSort={table.toggleSort}
        onTurnaround={(aircraftId) => onOpenTurnaround({ mode: "aircraft", aircraftId })}
        rows={table.pagedAircraft}
        sortDirection={sort.direction}
        sortKey={sort.key}
      />
    );
  }
  if (category === "pilots") {
    const sort = categorySort(table, category);
    return (
      <PilotCodesWorkspace
        emptyLabel={emptyState}
        onDelete={(id, label) => onDelete("PILOT", id, label)}
        onEdit={onEdit.pilots}
        onSort={table.toggleSort}
        rows={table.pagedPilots}
        sortDirection={sort.direction}
        sortKey={sort.key}
      />
    );
  }
  const sort = categorySort(table, category);
  return (
    <ProductsWorkspace
      emptyLabel={emptyState}
      onDelete={(id, label) => onDelete("PRODUCT", id, label)}
      onEdit={onEdit.products}
      onSales={onOpenSales}
      onSort={table.toggleSort}
      onTurnaround={(productId) => onOpenTurnaround({ mode: "product", productId })}
      rows={table.pagedProducts}
      sortDirection={sort.direction}
      sortKey={sort.key}
    />
  );
}
