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
  return (
    <section
      aria-labelledby={`admin-event-step-${eventStep}-tab`}
      id={`admin-event-step-${eventStep}-panel`}
      role="tabpanel"
    >
      <MasterDataWorkspace
        addAriaLabel={`${presentation.singularLabel} hinzufügen`}
        event={board.event}
        filters={
          category === "resource-groups" ? (
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
          ) : undefined
        }
        onNew={onNew}
        onSearchChange={table.setSearch}
        resultCount={table.filteredCount}
        search={table.search}
      >
        {category === "gates" ? (
          <GatesWorkspace
            board={board}
            emptyLabel={emptyState}
            onDelete={(id, label) => onDelete("GATE", id, label)}
            onEdit={onEdit.gates}
            onSort={table.toggleSort}
            rows={table.pagedGates}
            sortDirection={table.sort.category === "gates" ? table.sort.direction : null}
            sortKey={table.sort.category === "gates" ? table.sort.key : undefined}
          />
        ) : null}
        {category === "resource-groups" ? (
          <ResourceGroupsWorkspace
            board={board}
            onAssign={(resourceGroupId) =>
              onOpenAssignment({ mode: "resource-group", resourceGroupId })
            }
            onDelete={(id, label) => onDelete("RESOURCE_GROUP", id, label)}
            onEdit={onEdit.resourceGroups}
            rows={table.pagedResourceGroups}
          />
        ) : null}
        {category === "aircraft" ? (
          <AircraftWorkspace
            board={board}
            emptyLabel={emptyState}
            onAssign={(aircraftId) => onOpenAssignment({ mode: "aircraft", aircraftId })}
            onDelete={(id, label) => onDelete("AIRCRAFT", id, label)}
            onEdit={onEdit.aircraft}
            onSort={table.toggleSort}
            onTurnaround={(aircraftId) => onOpenTurnaround({ mode: "aircraft", aircraftId })}
            rows={table.pagedAircraft}
            sortDirection={table.sort.category === "aircraft" ? table.sort.direction : null}
            sortKey={table.sort.category === "aircraft" ? table.sort.key : undefined}
          />
        ) : null}
        {category === "pilots" ? (
          <PilotCodesWorkspace
            emptyLabel={emptyState}
            onDelete={(id, label) => onDelete("PILOT", id, label)}
            onEdit={onEdit.pilots}
            onSort={table.toggleSort}
            rows={table.pagedPilots}
            sortDirection={table.sort.category === "pilots" ? table.sort.direction : null}
            sortKey={table.sort.category === "pilots" ? table.sort.key : undefined}
          />
        ) : null}
        {category === "products" ? (
          <ProductsWorkspace
            emptyLabel={emptyState}
            onDelete={(id, label) => onDelete("PRODUCT", id, label)}
            onEdit={onEdit.products}
            onSales={onOpenSales}
            onSort={table.toggleSort}
            onTurnaround={(productId) => onOpenTurnaround({ mode: "product", productId })}
            rows={table.pagedProducts}
            sortDirection={table.sort.category === "products" ? table.sort.direction : null}
            sortKey={table.sort.category === "products" ? table.sort.key : undefined}
          />
        ) : null}
        {category === "resource-groups" && table.filteredCount === 0 ? emptyState : null}
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
