import { lazy } from "react";

export const AccountManagement = lazy(() =>
  import("../auth/AccountManagement").then((module) => ({
    default: module.AccountManagement,
  })),
);

export const AdminCompletionWorkspacePanel = lazy(() =>
  import("./completion/AdminCompletionWorkspacePanel").then((module) => ({
    default: module.AdminCompletionWorkspacePanel,
  })),
);

export const AdminMasterDataWorkspacePanel = lazy(() =>
  import("./master-data/AdminMasterDataWorkspacePanel").then((module) => ({
    default: module.AdminMasterDataWorkspacePanel,
  })),
);

export const AdminOperationalPlanPanel = lazy(() =>
  import("./operational-plan/AdminOperationalPlanPanel").then((module) => ({
    default: module.AdminOperationalPlanPanel,
  })),
);

export const AdminOperationsPanel = lazy(() =>
  import("./operations/AdminOperationsPanel").then((module) => ({
    default: module.AdminOperationsPanel,
  })),
);

export const AnalysisWorkspace = lazy(() =>
  import("../analysis/AnalysisWorkspace").then((module) => ({
    default: module.AnalysisWorkspace,
  })),
);

export const EventCatalogDialog = lazy(() =>
  import("./event-workspace/EventCatalogDialog").then((module) => ({
    default: module.EventCatalogDialog,
  })),
);

export const EventParametersWorkspace = lazy(() =>
  import("./event-parameters/EventParametersWorkspace").then((module) => ({
    default: module.EventParametersWorkspace,
  })),
);

export function AdminWorkspaceLoading() {
  return <output className="admin-section">Administrationsbereich wird geladen …</output>;
}
