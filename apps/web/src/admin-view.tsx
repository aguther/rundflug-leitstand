import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  AdminNavigation,
  type MasterDataCategory,
  SetupProgress,
  type SetupStep,
} from "./admin-ux";
import { AppShell as Shell } from "./app/AppShell";
import { PageNotice, useActionMessageBridge } from "./app/PageNotifications";
import { Button, PageHeader, StatusPill } from "./design-system/components";
import { formatEventLocalDateTime } from "./event-time";
import { AdminFactoryResetPanel } from "./features/admin/AdminFactoryResetPanel";
import { AdminShellDialogs } from "./features/admin/AdminShellDialogs";
import * as LazyAdmin from "./features/admin/admin-lazy-components";
import {
  adminAreaCopy,
  adminEventStepCopy,
  createAdminSetupSteps,
  summarizeAdminSetup,
} from "./features/admin/admin-shell-model";
import { getAdminStatusPresentation } from "./features/admin/admin-status-presentation";
import type { TurnaroundOverrideContext } from "./features/admin/aircraft/AircraftProductTurnaroundOverrideDialog";
import type { AircraftResourceGroupAssignmentContext } from "./features/admin/aircraft/AircraftResourceGroupAssignmentDialog";
import { useAircraftEditorState } from "./features/admin/aircraft/useAircraftEditorState";
import { useAdminHistory } from "./features/admin/completion/useAdminHistory";
import { useAdminEventConfigurationActions } from "./features/admin/event-parameters/useAdminEventConfigurationActions";
import { useAdminEventCatalog } from "./features/admin/event-workspace/useAdminEventCatalog";
import { useAdminEventWorkspaceNavigation } from "./features/admin/event-workspace/useAdminEventWorkspaceNavigation";
import { useGateEditorState } from "./features/admin/gates/useGateEditorState";
import {
  AdminMasterEditorFooter,
  AdminMasterEditorFurtherActions,
  getAdminMasterEditorPresentation,
} from "./features/admin/master-data/AdminMasterEditorActions";
import { MasterDataEmptyState } from "./features/admin/master-data/MasterDataWorkspace";
import { useAdminMasterDataActions } from "./features/admin/master-data/useAdminMasterDataActions";
import { useAdminMasterDataDeletion } from "./features/admin/master-data/useAdminMasterDataDeletion";
import { useAdminMasterDataTable } from "./features/admin/master-data/useAdminMasterDataTable";
import { useAdminMasterEditorState } from "./features/admin/master-data/useAdminMasterEditorState";
import { useMasterDataTemplateImport } from "./features/admin/master-data/useMasterDataTemplateImport";
import { AdminAccessStatusBar } from "./features/admin/overview/AdminAccessStatusBar";
import { AdminOverviewPanel } from "./features/admin/overview/AdminOverviewPanel";
import { AdminSimulationLauncher } from "./features/admin/overview/AdminSimulationLauncher";
import { useAdminEventFlow } from "./features/admin/overview/useAdminEventFlow";
import { usePilotEditorState } from "./features/admin/pilots/usePilotEditorState";
import { useProductEditorState } from "./features/admin/products/useProductEditorState";
import { useResourceGroupEditorState } from "./features/admin/resource-groups/useResourceGroupEditorState";
import { useAdminAuthorization } from "./features/admin/useAdminAuthorization";
import { useAdminFactoryReset } from "./features/admin/useAdminFactoryReset";
import { useAdminShellState } from "./features/admin/useAdminShellState";
import { useAuth } from "./features/auth/AuthContext";
import {
  ConnectionNotice,
  EmergencyNotice,
  InterruptionNotice,
  OperationalNotice,
  useOperationBoard,
  useOperationIdentity,
} from "./operation-workspace";

export function AdminView() {
  const { session, logout } = useAuth();
  const adminIdentity = useOperationIdentity("ADMIN", "technical-scaffold");
  const { eventId: EVENT_ID } = adminIdentity;
  const { board, error, lastConfirmedAt, backendConfirmed, refresh, refreshing } =
    useOperationBoard(adminIdentity);
  const initialAdminParams = useRef(new URLSearchParams(window.location.search)).current;
  const [accountCreateOpen, setAccountCreateOpen] = useState(false);
  const [masterDataCategory, setMasterDataCategory] = useState<MasterDataCategory>(() => {
    const requestedSection = initialAdminParams.get("section");
    const validSections: MasterDataCategory[] = [
      "gates",
      "resource-groups",
      "aircraft",
      "assignments",
      "pilots",
      "products",
    ];
    if (requestedSection === "assignments") return "aircraft";
    return (validSections as string[]).includes(requestedSection ?? "")
      ? (requestedSection as MasterDataCategory)
      : "resource-groups";
  });
  const masterDataTable = useAdminMasterDataTable({ board, category: masterDataCategory });
  const { alphabeticalProducts, totalCount: totalMasterDataCount } = masterDataTable;
  const handleSetupStepSelected = useCallback((step: SetupStep) => {
    if (step.category) setMasterDataCategory(step.category);
  }, []);
  const {
    adminArea,
    adminWorkspaceScrollRef,
    cancelPendingNavigation,
    changeAdminArea,
    confirmPendingNavigation,
    discardEventNavigationOpen,
    eventParametersResetKey,
    eventStep,
    openSetupStep,
    setEventParametersDirty,
  } = useAdminEventWorkspaceNavigation({
    initialParams: initialAdminParams,
    onStepSelected: handleSetupStepSelected,
  });
  const legacyAssignmentRequestRef = useRef({
    requested:
      initialAdminParams.get("area") === "master-data" &&
      initialAdminParams.get("section") === "assignments",
    aircraftId: initialAdminParams.get("aircraftId") ?? "",
    handled: false,
  });
  const {
    busyActionKey,
    logoutAndReload,
    logoutBusy,
    pushConfigurationStatus,
    runBusyAction,
    setupRequired,
  } = useAdminShellState({ boardAvailable: Boolean(board), logout });
  const initialMasterSelectionRef = useRef(false);
  const [assignmentDialogContext, setAssignmentDialogContext] =
    useState<AircraftResourceGroupAssignmentContext | null>(null);
  const [turnaroundDialogContext, setTurnaroundDialogContext] =
    useState<TurnaroundOverrideContext | null>(null);
  const [saleClosesAt, setSaleClosesAt] = useState("");
  const [salesProductId, setSalesProductId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useActionMessageBridge(message, setMessage);
  const adminHistory = useAdminHistory({
    activeArea: adminArea,
    activeEventStep: eventStep,
    onError: setMessage,
    timeZone: board?.event.timeZone ?? "Europe/Berlin",
  });
  const refreshHistory = adminHistory.refreshAuditHistory;
  const pilotEditor = usePilotEditorState(board?.pilots);
  const productEditor = useProductEditorState(board);
  const gateEditor = useGateEditorState(board?.gates);
  const [manifestCorrectionResetKey, setManifestCorrectionResetKey] = useState(0);
  const resourceEditor = useResourceGroupEditorState(board);
  const aircraftEditor = useAircraftEditorState(board);
  const masterEditorState = useAdminMasterEditorState({
    category: masterDataCategory,
    editors: {
      aircraft: aircraftEditor,
      gates: gateEditor,
      pilots: pilotEditor,
      products: productEditor,
      resourceGroups: resourceEditor,
    },
  });
  const {
    finish: finishMasterEditor,
    requestClose: requestMasterEditorClose,
    resetForStepChange: resetMasterEditorForStepChange,
    selectAircraft: selectAircraftForEditing,
    selectGate: selectGateForEditing,
    selectPilot: selectPilotForEditing,
    selectProduct: selectProductForEditing,
    selectResourceGroup: selectResourceForEditing,
    setOpen: setMasterEditorOpen,
    setSubmitAttempted: setMasterSubmitAttempted,
    startNewEntry: startNewMasterDataEntry,
  } = masterEditorState;
  useEffect(() => {
    if (["gates", "resource-groups", "aircraft", "pilots", "products"].includes(eventStep)) {
      setMasterDataCategory(eventStep as MasterDataCategory);
      resetMasterEditorForStepChange();
      masterDataTable.setSearch("");
    }
  }, [eventStep, masterDataTable.setSearch, resetMasterEditorForStepChange]);
  const [eventDialogView, setEventDialogView] = useState<"closed" | "catalog" | "create">("closed");
  const resourceGroups = board?.resourceGroups ?? [];
  const isAdministrator = session?.account.role === "ADMIN" || board?.currentDeviceRole === "ADMIN";
  const authorization = useAdminAuthorization({
    accountIsAdministrator: session?.account.role === "ADMIN",
    administrator: isAdministrator,
    onMessage: setMessage,
  });
  const {
    clearPinWhenLocked,
    getPin: getAdminPin,
    lockMode: lockAdminMode,
    modeUnlocked: adminModeUnlocked,
    requestAction: requestAdminAction,
    requestModeUnlock: requestAdminModeUnlock,
    setPin: setAdminPin,
  } = authorization;
  const eventVersion = board?.event.version;
  const eventCatalog = useAdminEventCatalog({
    administrator: isAdministrator,
    board,
    onMessage: setMessage,
    onViewChange: setEventDialogView,
    view: eventDialogView,
  });
  const masterDataDeletion = useAdminMasterDataDeletion({
    adminModeUnlocked,
    board,
    getAdminPin,
    onClearAdminPin: () => setAdminPin(""),
    onEditorOpenChange: setMasterEditorOpen,
    onFinishEditor: finishMasterEditor,
    onMessage: setMessage,
    onRefreshBoard: refresh,
    onRefreshHistory: refreshHistory,
  });
  const {
    requestClearEventLogo,
    requestSaveEventLogo,
    requestSaveEventParameters,
    setEventLifecycle,
  } = useAdminEventConfigurationActions({
    board,
    clearPinWhenLocked,
    getAdminPin,
    onMessage: setMessage,
    refreshBoard: refresh,
    refreshEvents: eventCatalog.refreshEvents,
    refreshHistory,
    requestAdminAction,
    runBusyAction,
  });
  const templateImport = useMasterDataTemplateImport({
    board,
    onMessage: setMessage,
    onRefreshBoard: refresh,
    onRefreshEvents: eventCatalog.refreshEvents,
    onRefreshHistory: refreshHistory,
  });
  const eventFlow = useAdminEventFlow({
    active: adminArea === "overview",
    administrator: isAdministrator,
    eventVersion,
  });
  const factoryResetState = useAdminFactoryReset({ onMessage: setMessage });
  const { requestDeletion: requestMasterDelete } = masterDataDeletion;
  const masterDataActions = useAdminMasterDataActions({
    administrator: isAdministrator,
    board,
    category: masterDataCategory,
    clearPinWhenLocked,
    editors: {
      aircraft: aircraftEditor,
      gate: gateEditor,
      pilot: pilotEditor,
      product: productEditor,
      resourceGroup: resourceEditor,
    },
    finishEditor: finishMasterEditor,
    getAdminPin,
    onAssignmentComplete: () => setAssignmentDialogContext(null),
    onManifestCorrected: () => setManifestCorrectionResetKey((current) => current + 1),
    onMessage: setMessage,
    onSalesComplete: () => setSalesProductId(null),
    refreshBoard: refresh,
    refreshHistory,
    requestAdminAction,
    runBusyAction,
    selectAircraft: selectAircraftForEditing,
    selectProduct: selectProductForEditing,
    selectResourceGroup: selectResourceForEditing,
    setSubmitAttempted: setMasterSubmitAttempted,
  });
  const { emergency, requestCurrentMasterSave, requestManifestCorrection } = masterDataActions;

  useEffect(() => {
    if (
      initialMasterSelectionRef.current ||
      adminArea !== "events" ||
      !["gates", "resource-groups", "aircraft", "pilots", "products"].includes(eventStep) ||
      !board
    )
      return;
    initialMasterSelectionRef.current = true;
    resourceEditor.select(board.resourceGroups[0]?.id ?? "new");
  }, [adminArea, board, eventStep, resourceEditor.select]);

  useEffect(() => {
    const legacyRequest = legacyAssignmentRequestRef.current;
    if (!legacyRequest.requested || legacyRequest.handled || !board || eventStep !== "aircraft") {
      return;
    }
    legacyRequest.handled = true;
    if (board.aircraft.some((aircraft) => aircraft.id === legacyRequest.aircraftId)) {
      setAssignmentDialogContext({ mode: "aircraft", aircraftId: legacyRequest.aircraftId });
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>("[data-primary-assignment-action]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [board, eventStep]);

  const setupSteps = createAdminSetupSteps(board);
  const { complete: setupComplete, completedSteps: completedSetupSteps } =
    summarizeAdminSetup(setupSteps);

  const masterEditorPresentation = getAdminMasterEditorPresentation(
    masterDataCategory,
    totalMasterDataCount,
    {
      aircraft: aircraftEditor,
      gate: gateEditor,
      pilot: pilotEditor,
      product: productEditor,
      resourceGroup: resourceEditor,
    },
  );
  const masterDataEmptyState = (
    <MasterDataEmptyState
      description={masterEditorPresentation.emptyDescription}
      title={masterEditorPresentation.emptyTitle}
    />
  );
  const masterDataStepActive =
    adminArea === "events" &&
    ["gates", "resource-groups", "aircraft", "pilots", "products"].includes(eventStep);
  const masterEditorFooter = (
    <AdminMasterEditorFooter
      administrator={isAdministrator}
      busy={busyActionKey === masterEditorPresentation.busyKey}
      deleteAction={masterEditorPresentation.deleteAction}
      onCancel={requestMasterEditorClose}
      onDelete={(action) => requestMasterDelete(action.entityType, action.entityId, action.label)}
      onSave={requestCurrentMasterSave}
    />
  );
  const masterEditorMobileFurtherActions = (
    <AdminMasterEditorFurtherActions
      administrator={isAdministrator}
      deleteAction={masterEditorPresentation.deleteAction}
      onDelete={(action) => requestMasterDelete(action.entityType, action.entityId, action.label)}
    />
  );
  const renderEventWorkspace = () => {
    if (!board) return null;

    switch (eventStep) {
      case "event":
        return (
          <div
            aria-labelledby="admin-event-step-event-tab"
            className="event-setup-v15 single-panel"
            id="admin-event-step-event-panel"
            role="tabpanel"
          >
            <LazyAdmin.EventParametersWorkspace
              administrator={isAdministrator}
              busyActionKey={busyActionKey}
              event={board.event}
              key={`${board.event.eventId}-${eventParametersResetKey}`}
              onDirtyChange={setEventParametersDirty}
              onRemoveLogo={requestClearEventLogo}
              onSave={requestSaveEventParameters}
              onUploadLogo={requestSaveEventLogo}
            />
          </div>
        );
      case "gates":
      case "resource-groups":
      case "aircraft":
      case "pilots":
      case "products":
        return (
          <LazyAdmin.AdminMasterDataWorkspacePanel
            board={board}
            category={masterDataCategory}
            emptyState={masterDataEmptyState}
            eventStep={eventStep}
            onDelete={requestMasterDelete}
            onEdit={{
              aircraft: selectAircraftForEditing,
              gates: selectGateForEditing,
              pilots: selectPilotForEditing,
              products: selectProductForEditing,
              resourceGroups: selectResourceForEditing,
            }}
            onNew={startNewMasterDataEntry}
            onOpenAssignment={setAssignmentDialogContext}
            onOpenSales={(productId) => {
              const product = board.products.find((entry) => entry.id === productId);
              if (!product) return;
              setSalesProductId(product.id);
              setSaleClosesAt(
                product.saleClosesAt
                  ? formatEventLocalDateTime(product.saleClosesAt, board.event.timeZone)
                  : "",
              );
            }}
            onOpenTurnaround={setTurnaroundDialogContext}
            presentation={masterEditorPresentation}
            table={masterDataTable}
          />
        );
      case "operational-plan":
        return (
          <LazyAdmin.AdminOperationalPlanPanel
            board={board}
            busy={busyActionKey !== null}
            onMessage={setMessage}
            onRefresh={refresh}
            onRefreshHistory={refreshHistory}
            onRunBusyAction={runBusyAction}
            readOnly={!isAdministrator || !adminModeUnlocked}
          />
        );
      case "operations":
        return (
          <LazyAdmin.AdminOperationsPanel
            administrator={isAdministrator}
            board={board}
            busyActionKey={busyActionKey}
            completedSetupSteps={completedSetupSteps}
            onEmergency={(action, emergencyReason) => {
              let succeeded = false;
              return runBusyAction(
                action === "CLEAR_EMERGENCY" ? "emergency-clear" : "emergency-trigger",
                async () => {
                  succeeded = await emergency(action, emergencyReason);
                },
              ).then(() => succeeded);
            }}
            onOpenSetupStep={openSetupStep}
            onRequestAdminAction={requestAdminAction}
            onSetEventLifecycle={setEventLifecycle}
            setupComplete={setupComplete}
            setupSteps={setupSteps}
          />
        );
      case "completion":
        return (
          <LazyAdmin.AdminCompletionWorkspacePanel
            administrator={isAdministrator}
            board={board}
            busyActionKey={busyActionKey}
            history={adminHistory}
            manifestCorrectionResetKey={manifestCorrectionResetKey}
            onMessage={setMessage}
            onRequestManifestCorrection={requestManifestCorrection}
            onRunBusyAction={runBusyAction}
          />
        );
      default:
        return null;
    }
  };
  const renderAreaWorkspace = () => {
    switch (adminArea) {
      case "overview":
        return board ? (
          <AdminOverviewPanel
            board={board}
            eventFlow={eventFlow.flow}
            eventFlowError={eventFlow.error}
            eventFlowLoading={eventFlow.loading}
            pushConfigurationStatus={pushConfigurationStatus}
          />
        ) : null;
      case "users":
        return (
          <LazyAdmin.AccountManagement
            createOpen={accountCreateOpen}
            onCreateOpenChange={setAccountCreateOpen}
          />
        );
      case "backup":
        return (
          <AdminFactoryResetPanel
            administrator={isAdministrator}
            onOpen={factoryResetState.openDialog}
          />
        );
      case "evaluation":
        return (
          <LazyAdmin.AnalysisWorkspace
            backendConfirmed={backendConfirmed}
            board={board}
            onRefresh={refresh}
            simulator={
              <AdminSimulationLauncher
                available={Boolean(board)}
                busyActionKey={busyActionKey}
                onMessage={setMessage}
                onRunBusyAction={runBusyAction}
              />
            }
          />
        );
      case "events":
        return renderEventWorkspace();
      default:
        return null;
    }
  };
  const statusPresentation = getAdminStatusPresentation(board?.event.status, error);
  return (
    <Shell
      className="admin-shell"
      connection={{ backendConfirmed, error, lastConfirmedAt }}
      title="Administration"
      notifications={
        <>
          <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
          {setupRequired ? (
            <PageNotice noticeKey="setup-required" tone="warning">
              Dieses System ist noch nicht eingerichtet. <a href="/setup">Ersteinrichtung öffnen</a>
            </PageNotice>
          ) : null}
          <EmergencyNotice active={board?.event.emergencyMode ?? false} />
          <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
          <OperationalNotice note={board?.event.operationalNote} />
        </>
      }
    >
      <section className="admin-layout">
        <AdminNavigation activeArea={adminArea} onChange={changeAdminArea} />
        <div
          className={`admin-workspace admin-workspace--${adminArea} ${masterDataStepActive ? "master-data-active" : ""}`.trim()}
        >
          <PageHeader
            actions={
              <div className="admin-page-header-actions">
                {adminArea === "events" ? (
                  <Button onClick={() => setEventDialogView("catalog")} size="compact">
                    Veranstaltungen verwalten
                  </Button>
                ) : null}
                <StatusPill tone={statusPresentation.tone}>{statusPresentation.label}</StatusPill>
              </div>
            }
            description={
              adminArea === "events"
                ? adminEventStepCopy[eventStep].description
                : adminAreaCopy[adminArea].description
            }
            title={
              adminArea === "events"
                ? adminEventStepCopy[eventStep].title
                : adminAreaCopy[adminArea].title
            }
          />
          <Suspense fallback={null}>
            {adminArea === "events" ? (
              <LazyAdmin.EventCatalogDialog
                busyActionKey={busyActionKey}
                canExport={Boolean(board)}
                canManage={isAdministrator}
                creation={eventCatalog.creation}
                currentEventId={EVENT_ID}
                currentEventName={board?.event.name ?? EVENT_ID}
                currentStep={eventStep}
                events={eventCatalog.visibleEvents}
                onClose={eventCatalog.closeDialog}
                onCreateSubmit={() => void runBusyAction("create-event", eventCatalog.createEvent)}
                onDelete={(entry) =>
                  void runBusyAction(`delete-event-${entry.eventId}`, () =>
                    eventCatalog.removeEvent(entry),
                  )
                }
                onExport={() =>
                  void runBusyAction("export-master-data-template", eventCatalog.exportTemplate)
                }
                onImport={() => {
                  templateImport.openDialog();
                }}
                onOpenCreate={eventCatalog.openCreation}
                onSearchChange={eventCatalog.setSearch}
                onSetCreationAerodrome={eventCatalog.setAerodrome}
                onSetCreationConfirmation={eventCatalog.setConfirmation}
                onSetCreationDate={eventCatalog.setEventDate}
                onSetCreationId={eventCatalog.setEventId}
                onSetCreationName={eventCatalog.setName}
                onSetRestartMode={eventCatalog.setRestartMode}
                onShowCatalog={eventCatalog.showCatalog}
                onSort={eventCatalog.toggleSort}
                search={eventCatalog.search}
                sort={eventCatalog.sort}
                view={eventCatalog.view}
              />
            ) : null}
          </Suspense>
          {adminArea === "events" ? (
            <SetupProgress currentStepId={eventStep} onSelect={openSetupStep} steps={setupSteps} />
          ) : null}
          {/* biome-ignore format: preserve the large existing workspace subtree while adding its scroll boundary */}
          <div className="admin-workspace-scroll-region" ref={adminWorkspaceScrollRef}>
            <Suspense fallback={<LazyAdmin.AdminWorkspaceLoading />}>
            {board?.currentDeviceRole === "FLIGHT_DIRECTOR" ? (
              <div className="readonly-banner">Flight-Director-Ansicht · primär lesend</div>
            ) : null}
            <AdminAccessStatusBar
              adminModeUnlocked={adminModeUnlocked}
              administrator={isAdministrator}
              authenticatedAdminLoginCode={
                session?.account.role === "ADMIN" ? session.account.loginCode : null
              }
              boardLoadFailed={Boolean(error)}
              logoutBusy={logoutBusy}
              onLockAdminMode={() => lockAdminMode()}
              onLogout={() => void logoutAndReload()}
              onRefresh={() => void refresh()}
              onRequestAdminModeUnlock={requestAdminModeUnlock}
              refreshing={refreshing}
            />
            {renderAreaWorkspace()}
          <AdminShellDialogs
            administrator={isAdministrator}
            assignmentContext={assignmentDialogContext}
            authorization={authorization}
            board={board}
            busyActionKey={busyActionKey}
            cancelPendingNavigation={cancelPendingNavigation}
            category={masterDataCategory}
            confirmPendingNavigation={confirmPendingNavigation}
            deletion={masterDataDeletion}
            discardEventNavigationOpen={discardEventNavigationOpen}
            editorFooter={masterEditorFooter}
            editorFurtherActions={masterEditorMobileFurtherActions}
            editorPresentation={masterEditorPresentation}
            editors={{
              aircraft: aircraftEditor,
              gate: gateEditor,
              pilot: pilotEditor,
              product: productEditor,
              resourceGroup: resourceEditor,
            }}
            editorState={masterEditorState}
            factoryReset={factoryResetState}
            masterDataActions={masterDataActions}
            masterDataStepActive={masterDataStepActive}
            products={alphabeticalProducts}
            requestAdminAction={requestAdminAction}
            resourceGroups={resourceGroups}
            runBusyAction={runBusyAction}
            saleClosesAt={saleClosesAt}
            salesProductId={salesProductId}
            setAssignmentContext={setAssignmentDialogContext}
            setSaleClosesAt={setSaleClosesAt}
            setSalesProductId={setSalesProductId}
            setTurnaroundContext={setTurnaroundDialogContext}
            templateImport={templateImport}
            turnaroundContext={turnaroundDialogContext}
          />
            </Suspense>
          </div>
        </div>
      </section>
    </Shell>
  );
}

import "./features/admin/admin-v12.css";
import "./features/admin/admin-v15.css";
import "./features/admin/admin-event-workspace.css";
import "./features/admin/admin-modernization.css";
import "./features/admin/event-parameters/event-parameters.css";
