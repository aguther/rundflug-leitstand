import type { OperationBoard } from "@rundflug/contracts";
import type { ReactNode } from "react";
import type { MasterDataCategory } from "../../../admin-ux";
import type { TurnaroundOverrideContext } from "../aircraft/AircraftProductTurnaroundOverrideDialog";
import type { AircraftResourceGroupAssignmentContext } from "../aircraft/AircraftResourceGroupAssignmentDialog";
import { CategoryWorkspace } from "./AdminMasterDataCategoryWorkspace";
import type { getAdminMasterEditorPresentation } from "./AdminMasterEditorActions";
import { MasterDataPagination } from "./MasterDataPagination";
import { MasterDataWorkspace } from "./MasterDataWorkspace";
import type { useAdminMasterDataTable } from "./useAdminMasterDataTable";

type MasterDataTableState = ReturnType<typeof useAdminMasterDataTable>;

type MasterDataEntity = "AIRCRAFT" | "GATE" | "PILOT" | "PRODUCT" | "RESOURCE_GROUP";

export interface AdminMasterDataWorkspacePanelProps {
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
