import type { OperationBoard } from "@rundflug/contracts";
import type { ReactNode } from "react";
import type { MasterDataCategory } from "../../../admin-ux";
import type { TurnaroundOverrideContext } from "../aircraft/AircraftProductTurnaroundOverrideDialog";
import type { AircraftResourceGroupAssignmentContext } from "../aircraft/AircraftResourceGroupAssignmentDialog";
import { AircraftWorkspace } from "../aircraft/AircraftWorkspace";
import { GatesWorkspace } from "../gates/GatesWorkspace";
import { PilotCodesWorkspace } from "../pilots/PilotCodesWorkspace";
import { ProductsWorkspace } from "../products/ProductsWorkspace";
import { ResourceGroupsWorkspace } from "../resource-groups/ResourceGroupsWorkspace";
import type { getAdminMasterEditorPresentation } from "./AdminMasterEditorActions";
import { MasterDataPagination } from "./MasterDataPagination";
import { MasterDataWorkspace } from "./MasterDataWorkspace";
import type { useAdminMasterDataTable } from "./useAdminMasterDataTable";

type MasterDataTableState = ReturnType<typeof useAdminMasterDataTable>;

type MasterDataEntity = "AIRCRAFT" | "GATE" | "PILOT" | "PRODUCT" | "RESOURCE_GROUP";

interface AdminMasterDataWorkspacePanelProps {
  board: OperationBoard;
  category: MasterDataCategory;
  emptyState: ReactNode;
  eventStep: string;
  onDelete: (entityType: MasterDataEntity, id: string, label: string) => void;
  onEdit: Record<
    "aircraft" | "gates" | "pilots" | "products" | "resourceGroups",
    (id: string) => void
  >;
  onNew: () => void;
  onOpenAssignment: (context: AircraftResourceGroupAssignmentContext) => void;
  onOpenSales: (productId: string) => void;
  onOpenTurnaround: (context: TurnaroundOverrideContext) => void;
  presentation: ReturnType<typeof getAdminMasterEditorPresentation>;
  table: MasterDataTableState;
}

function categorySort(table: MasterDataTableState, category: MasterDataCategory) {
  if (table.sort.category !== category) return { direction: null, key: undefined };
  return { direction: table.sort.direction, key: table.sort.key };
}

function CategoryWorkspace({
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

export function AdminMasterDataWorkspacePanel({
  board,
  category,
  emptyState,
  eventStep,
  onDelete,
  onEdit,
  onNew,
  onOpenAssignment,
  onOpenSales,
  onOpenTurnaround,
  presentation,
  table,
}: Readonly<AdminMasterDataWorkspacePanelProps>) {
  function renderFilters() {
    if (category !== "resource-groups") return undefined;
    return (
      <label className="master-data-status-filter">
        <span>Status</span>
        <select
          onChange={(event) => table.setResourceStatusFilter(event.target.value)}
          value={table.resourceStatusFilter}
        >
          <option value="ALL">Alle Status</option>
          <option value="ACTIVE">Aktiv</option>
          <option value="PAUSED">Pausiert</option>
          <option value="INTERRUPTED">Unterbrochen</option>
          <option value="ENDED">Beendet</option>
        </select>
      </label>
    );
  }

  return (
    <section
      aria-labelledby={`admin-event-step-${eventStep}-tab`}
      id={`admin-event-step-${eventStep}-panel`}
      role="tabpanel"
    >
      <MasterDataWorkspace
        addAriaLabel={`${presentation.singularLabel} hinzufügen`}
        event={board.event}
        filters={renderFilters()}
        onNew={onNew}
        onSearchChange={table.setSearch}
        resultCount={table.filteredCount}
        search={table.search}
      >
        <CategoryWorkspace
          board={board}
          category={category}
          emptyState={emptyState}
          onDelete={onDelete}
          onEdit={onEdit}
          onOpenAssignment={onOpenAssignment}
          onOpenSales={onOpenSales}
          onOpenTurnaround={onOpenTurnaround}
          table={table}
        />
        <MasterDataPagination
          count={table.filteredCount}
          onPageChange={table.setPage}
          onPageSizeChange={table.setPageSize}
          page={table.clampedPage}
          pageSize={table.pageSize}
        />
      </MasterDataWorkspace>
    </section>
  );
}
