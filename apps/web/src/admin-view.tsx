import { useCallback, useEffect, useRef, useState } from "react";
import {
  AdminNavigation,
  type MasterDataCategory,
  SetupProgress,
  type SetupStep,
  ValidationHint,
} from "./admin-ux";
import { getPushConfiguration, getSetupStatus } from "./api";
import { AppShell as Shell } from "./app/AppShell";
import { PageNotice, useActionMessageBridge } from "./app/PageNotifications";
import {
  Button,
  ConfirmationDialog,
  ModalDialog,
  PageHeader,
  StatusPill,
} from "./design-system/components";
import { eventLocalDateTimeToIso, formatEventLocalDateTime } from "./event-time";
import { AdminAuthorizationDialog } from "./features/admin/AdminAuthorizationDialog";
import {
  adminAreaCopy,
  adminEventStepCopy,
  createAdminSetupSteps,
  summarizeAdminSetup,
} from "./features/admin/admin-shell-model";
import {
  AircraftProductTurnaroundOverrideDialog,
  type TurnaroundOverrideContext,
} from "./features/admin/aircraft/AircraftProductTurnaroundOverrideDialog";
import {
  type AircraftResourceGroupAssignmentContext,
  AircraftResourceGroupAssignmentDialog,
} from "./features/admin/aircraft/AircraftResourceGroupAssignmentDialog";
import { useAircraftEditorState } from "./features/admin/aircraft/useAircraftEditorState";
import { AdminCompletionSummaryPanel } from "./features/admin/completion/AdminCompletionSummaryPanel";
import { CompletionHistoryPanel } from "./features/admin/completion/CompletionHistoryPanel";
import { CompletionWorkspace } from "./features/admin/completion/CompletionWorkspace";
import { ManifestCorrectionPanel } from "./features/admin/completion/ManifestCorrectionPanel";
import { useAdminHistory } from "./features/admin/completion/useAdminHistory";
import { EventParametersWorkspace } from "./features/admin/event-parameters/EventParametersWorkspace";
import { useAdminEventConfigurationActions } from "./features/admin/event-parameters/useAdminEventConfigurationActions";
import { EventCatalogDialog } from "./features/admin/event-workspace/EventCatalogDialog";
import { useAdminEventCatalog } from "./features/admin/event-workspace/useAdminEventCatalog";
import { useAdminEventWorkspaceNavigation } from "./features/admin/event-workspace/useAdminEventWorkspaceNavigation";
import { FactoryResetDialog } from "./features/admin/FactoryResetDialog";
import { GateEditorDialog } from "./features/admin/gates/GateEditorDialog";
import { useGateEditorState } from "./features/admin/gates/useGateEditorState";
import { AdminMasterDataWorkspacePanel } from "./features/admin/master-data/AdminMasterDataWorkspacePanel";
import {
  AdminMasterEditorFooter,
  AdminMasterEditorFurtherActions,
  getAdminMasterEditorPresentation,
} from "./features/admin/master-data/AdminMasterEditorActions";
import {
  MasterDataDeleteDialog,
  MasterDataTemplateImportDialog,
} from "./features/admin/master-data/MasterDataManagementDialogs";
import { MasterDataEmptyState } from "./features/admin/master-data/MasterDataWorkspace";
import { ResourceAircraftEditorDialog } from "./features/admin/master-data/ResourceAircraftEditorDialog";
import { useAdminMasterDataActions } from "./features/admin/master-data/useAdminMasterDataActions";
import { useAdminMasterDataDeletion } from "./features/admin/master-data/useAdminMasterDataDeletion";
import { useAdminMasterDataTable } from "./features/admin/master-data/useAdminMasterDataTable";
import { useAdminMasterEditorState } from "./features/admin/master-data/useAdminMasterEditorState";
import { useMasterDataTemplateImport } from "./features/admin/master-data/useMasterDataTemplateImport";
import { AdminOperationalPlanPanel } from "./features/admin/operational-plan/AdminOperationalPlanPanel";
import { AdminOperationsPanel } from "./features/admin/operations/AdminOperationsPanel";
import { AdminAccessStatusBar } from "./features/admin/overview/AdminAccessStatusBar";
import {
  AdminOverviewPanel,
  type PushConfigurationStatus,
} from "./features/admin/overview/AdminOverviewPanel";
import { AdminSimulationLauncher } from "./features/admin/overview/AdminSimulationLauncher";
import { useAdminEventFlow } from "./features/admin/overview/useAdminEventFlow";
import { PilotEditorDialog } from "./features/admin/pilots/PilotEditorDialog";
import { usePilotEditorState } from "./features/admin/pilots/usePilotEditorState";
import { ProductEditorDialog } from "./features/admin/products/ProductEditorDialog";
import { ProductSalesDialog } from "./features/admin/products/ProductSalesDialog";
import { useProductEditorState } from "./features/admin/products/useProductEditorState";
import { useResourceGroupEditorState } from "./features/admin/resource-groups/useResourceGroupEditorState";
import { useAdminAuthorization } from "./features/admin/useAdminAuthorization";
import { useAdminFactoryReset } from "./features/admin/useAdminFactoryReset";
import { AnalysisWorkspace } from "./features/analysis/AnalysisWorkspace";
import { AccountManagement } from "./features/auth/AccountManagement";
import { useAuth } from "./features/auth/AuthContext";
import {
  ADMIN_DEVICE_ID,
  ConnectionNotice,
  EmergencyNotice,
  EVENT_ID,
  InterruptionNotice,
  OperationalNotice,
  useOperationBoard,
} from "./operation-workspace";

export function AdminView() {
  const { session, logout } = useAuth();
  const { board, error, lastConfirmedAt, backendConfirmed, refresh, refreshing } =
    useOperationBoard(ADMIN_DEVICE_ID);
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
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const initialMasterSelectionRef = useRef(false);
  const [assignmentDialogContext, setAssignmentDialogContext] =
    useState<AircraftResourceGroupAssignmentContext | null>(null);
  const [turnaroundDialogContext, setTurnaroundDialogContext] =
    useState<TurnaroundOverrideContext | null>(null);
  async function runBusyAction(key: string, action: () => Promise<void>) {
    if (busyActionKey) return;
    setBusyActionKey(key);
    try {
      await action();
    } finally {
      setBusyActionKey(null);
    }
  }

  async function logoutAndReload() {
    setLogoutBusy(true);
    try {
      await logout();
      window.location.reload();
    } finally {
      setLogoutBusy(false);
    }
  }
  const [saleClosesAt, setSaleClosesAt] = useState("");
  const [salesProductId, setSalesProductId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useActionMessageBridge(message, setMessage);
  const [setupRequired, setSetupRequired] = useState(false);
  const {
    applyFilters: applyHistoryFilters,
    auditHistory: history,
    changeFilter: updateHistoryFilter,
    changeView: changeHistoryView,
    filters: historyFilters,
    forecastHistory,
    offset: historyOffset,
    operationalHistory,
    refreshAuditHistory: refreshHistory,
    refreshDetailedHistory,
    resetFilters: resetHistoryFilters,
    view: historyView,
  } = useAdminHistory({
    activeArea: adminArea,
    activeEventStep: eventStep,
    onError: setMessage,
    timeZone: board?.event.timeZone,
  });
  const pilotEditor = usePilotEditorState(board?.pilots);
  const [pushConfigurationStatus, setPushConfigurationStatus] =
    useState<PushConfigurationStatus>("loading");
  useEffect(() => {
    const controller = new AbortController();
    void getPushConfiguration(controller.signal)
      .then((configuration) =>
        setPushConfigurationStatus(configuration.configured ? "configured" : "missing"),
      )
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setPushConfigurationStatus("unavailable");
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (board) {
      setSetupRequired(false);
      return;
    }
    void getSetupStatus()
      .then((result) => setSetupRequired(result.setupRequired))
      .catch(() => setSetupRequired(false));
  }, [board]);
  const productEditor = useProductEditorState(board);
  const gateEditor = useGateEditorState(board?.gates);
  const [manifestCorrectionResetKey, setManifestCorrectionResetKey] = useState(0);
  const resourceEditor = useResourceGroupEditorState(board);
  const aircraftEditor = useAircraftEditorState(board);
  const {
    continueEditing: continueMasterEditing,
    dirty: masterEditorDirty,
    discardChanges: discardMasterChanges,
    discardChangesOpen: discardMasterChangesOpen,
    finish: finishMasterEditor,
    open: masterEditorOpen,
    requestClose: requestMasterEditorClose,
    resetForStepChange: resetMasterEditorForStepChange,
    selectAircraft: selectAircraftForEditing,
    selectGate: selectGateForEditing,
    selectPilot: selectPilotForEditing,
    selectProduct: selectProductForEditing,
    selectResourceGroup: selectResourceForEditing,
    setOpen: setMasterEditorOpen,
    setSubmitAttempted: setMasterSubmitAttempted,
    setTab: setMasterEditorTab,
    startNewEntry: startNewMasterDataEntry,
    submitAttempted: masterSubmitAttempted,
    tab: masterEditorTab,
  } = useAdminMasterEditorState({
    category: masterDataCategory,
    editors: {
      aircraft: aircraftEditor,
      gates: gateEditor,
      pilots: pilotEditor,
      products: productEditor,
      resourceGroups: resourceEditor,
    },
  });
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
  const {
    busy: adminPinBusy,
    clearPinWhenLocked,
    closeDialog: closeAdminPinDialog,
    confirmDialog: confirmAdminPinDialog,
    dialogMode: adminPinDialog,
    error: adminPinError,
    getPin: getAdminPin,
    inputRef: adminPinInputRef,
    lockMode: lockAdminMode,
    modeUnlocked: adminModeUnlocked,
    pin: adminPin,
    requestAction: requestAdminAction,
    requestModeUnlock: requestAdminModeUnlock,
    setPin: setAdminPin,
  } = useAdminAuthorization({
    accountIsAdministrator: session?.account.role === "ADMIN",
    administrator: isAdministrator,
    onMessage: setMessage,
  });
  const eventVersion = board?.event.version;
  const eventCatalog = useAdminEventCatalog({
    administrator: isAdministrator,
    board,
    onMessage: setMessage,
    onViewChange: setEventDialogView,
    view: eventDialogView,
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
  const {
    cancelDeletion: cancelMasterDelete,
    confirmDeletion: confirmMasterDelete,
    pendingDeletion: pendingMasterDelete,
    requestDeletion: requestMasterDelete,
  } = useAdminMasterDataDeletion({
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
    configureProductSales,
    emergency,
    requestAircraftAssignment,
    requestCurrentMasterSave,
    requestManifestCorrection,
    requestMasterSave,
    requestTurnaroundOverrideSave,
  } = useAdminMasterDataActions({
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
        <div className={`admin-workspace ${masterDataStepActive ? "master-data-active" : ""}`}>
          <PageHeader
            actions={
              <div className="admin-page-header-actions">
                {adminArea === "events" ? (
                  <Button onClick={() => setEventDialogView("catalog")} size="compact">
                    Veranstaltungen verwalten
                  </Button>
                ) : null}
                <StatusPill
                  tone={
                    board?.event.status === "ACTIVE"
                      ? "success"
                      : board?.event.status === "PREPARATION"
                        ? "warning"
                        : error
                          ? "danger"
                          : "neutral"
                  }
                >
                  {board?.event.status === "ACTIVE"
                    ? "Betrieb aktiv"
                    : board?.event.status === "PREPARATION"
                      ? "Betrieb noch nicht freigegeben"
                      : board?.event.status === "CLOSED"
                        ? "Betrieb geschlossen"
                        : error
                          ? "Stand nicht verfügbar"
                          : "Stand wird geladen"}
                </StatusPill>
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
          {adminArea === "events" ? (
            <EventCatalogDialog
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
          {adminArea === "events" ? (
            <SetupProgress currentStepId={eventStep} onSelect={openSetupStep} steps={setupSteps} />
          ) : null}
          {/* biome-ignore format: preserve the large existing workspace subtree while adding its scroll boundary */}
          <div className="admin-workspace-scroll-region" ref={adminWorkspaceScrollRef}>
            {board?.currentDeviceRole === "FLIGHT_DIRECTOR" ? (
              <div className="readonly-banner">Flight-Director-Ansicht · primär lesend</div>
            ) : null}
            {board && adminArea === "overview" ? (
              <AdminOverviewPanel
                board={board}
                eventFlow={eventFlow.flow}
                eventFlowError={eventFlow.error}
                eventFlowLoading={eventFlow.loading}
                pushConfigurationStatus={pushConfigurationStatus}
              />
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
          {adminArea === "users" ? (
            <AccountManagement
              createOpen={accountCreateOpen}
              onCreateOpenChange={setAccountCreateOpen}
            />
          ) : null}
          <section className="reset-levels" hidden={adminArea !== "backup"}>
            {!isAdministrator ? (
              <ValidationHint tone="error">
                Reset ist sichtbar, bleibt aber gesperrt, bis eine gültige Administrationssitzung
                bestätigt wurde.
              </ValidationHint>
            ) : null}
            <div className="reset-level-row factory-reset-row" hidden={adminArea !== "backup"}>
              <div>
                <h2>Werkszustand herstellen</h2>
                <p>
                  Alle Anwendungsdaten, Stammdaten, Historien, Sitzungen und die Ersteinrichtung
                  werden gelöscht. Danach startet das System wieder bei /setup.
                </p>
              </div>
              <button
                className="danger-action"
                disabled={!isAdministrator}
                onClick={factoryResetState.openDialog}
                type="button"
              >
                <span>Werkszustand vorbereiten</span>
              </button>
            </div>
          </section>
          <div
            aria-labelledby="admin-event-step-event-tab"
            className="event-setup-v15 single-panel"
            hidden={adminArea !== "events" || eventStep !== "event"}
            id="admin-event-step-event-panel"
            role="tabpanel"
          >
            {eventStep === "event" && board ? (
              <EventParametersWorkspace
                administrator={isAdministrator}
                busyActionKey={busyActionKey}
                event={board.event}
                key={`${board.event.eventId}-${eventParametersResetKey}`}
                onDirtyChange={setEventParametersDirty}
                onRemoveLogo={requestClearEventLogo}
                onSave={requestSaveEventParameters}
                onUploadLogo={requestSaveEventLogo}
              />
            ) : null}

          </div>

          {masterDataStepActive && board ? (
            <AdminMasterDataWorkspacePanel
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
          ) : null}
          {board ? (
            <AircraftResourceGroupAssignmentDialog
              board={board}
              busy={busyActionKey === "master-assignment"}
              context={assignmentDialogContext}
              onClose={() => setAssignmentDialogContext(null)}
              onConfirm={requestAircraftAssignment}
            />
          ) : null}
          {board ? (
            <AircraftProductTurnaroundOverrideDialog
              board={board}
              busyKey={busyActionKey}
              context={turnaroundDialogContext}
              onClose={() => setTurnaroundDialogContext(null)}
              onSave={requestTurnaroundOverrideSave}
            />
          ) : null}
          {board ? (
            <ProductSalesDialog
              busyAction={
                salesProductId && busyActionKey === `product-${salesProductId}-closing`
                  ? "closing"
                  : salesProductId && busyActionKey === `product-${salesProductId}-sales`
                    ? "toggle"
                    : null
              }
              closingValue={saleClosesAt}
              eventStatus={board.event.status}
              key={salesProductId ?? "closed"}
              onClose={() => setSalesProductId(null)}
              onClosingChange={setSaleClosesAt}
              onSaveClosing={(remove) => {
                const product = board.products.find((entry) => entry.id === salesProductId);
                if (!product) return;
                const closingTime = remove
                  ? null
                  : eventLocalDateTimeToIso(saleClosesAt, board.event.timeZone);
                requestAdminAction(() =>
                  runBusyAction(`product-${product.id}-closing`, () =>
                    configureProductSales(product, product.saleEnabled, closingTime),
                  ),
                );
              }}
              onToggleSales={() => {
                const product = board.products.find((entry) => entry.id === salesProductId);
                if (!product) return;
                requestAdminAction(() =>
                  runBusyAction(`product-${product.id}-sales`, () =>
                    configureProductSales(product, !product.saleEnabled),
                  ),
                );
              }}
              product={board.products.find((product) => product.id === salesProductId) ?? null}
            />
          ) : null}
          <GateEditorDialog
            editor={gateEditor}
            footer={masterEditorFooter}
            furtherActions={masterEditorMobileFurtherActions}
            initialFocusSelector={masterEditorPresentation.initialFocusSelector}
            onClose={requestMasterEditorClose}
            onTabChange={setMasterEditorTab}
            open={masterDataStepActive && masterEditorOpen && masterDataCategory === "gates"}
            products={alphabeticalProducts}
            resourceGroups={resourceGroups}
            submitAttempted={masterSubmitAttempted}
            tab={masterEditorTab}
          />
          <ProductEditorDialog
            board={board}
            editor={productEditor}
            footer={masterEditorFooter}
            furtherActions={masterEditorMobileFurtherActions}
            initialFocusSelector={masterEditorPresentation.initialFocusSelector}
            onClose={requestMasterEditorClose}
            onTabChange={setMasterEditorTab}
            open={masterDataStepActive && masterEditorOpen && masterDataCategory === "products"}
            resourceGroups={resourceGroups}
            submitAttempted={masterSubmitAttempted}
            tab={masterEditorTab}
          />
          <ResourceAircraftEditorDialog
            aircraftEditor={aircraftEditor}
            board={board}
            category={masterDataCategory}
            footer={masterEditorFooter}
            furtherActions={masterEditorMobileFurtherActions}
            initialFocusSelector={masterEditorPresentation.initialFocusSelector}
            onAssignAircraft={(resourceGroupId) =>
              setAssignmentDialogContext({ mode: "resource-group", resourceGroupId })
            }
            onClose={requestMasterEditorClose}
            open={
              masterDataStepActive &&
              masterEditorOpen &&
              ["resource-groups", "aircraft"].includes(masterDataCategory)
            }
            resourceEditor={resourceEditor}
            submitAttempted={masterSubmitAttempted}
          />
          <PilotEditorDialog
            administrator={isAdministrator}
            busy={busyActionKey === "master-pilot-toggle"}
            dirty={masterEditorDirty}
            editor={pilotEditor}
            footer={masterEditorFooter}
            furtherActions={masterEditorMobileFurtherActions}
            initialFocusSelector={masterEditorPresentation.initialFocusSelector}
            onClose={requestMasterEditorClose}
            onToggle={() => requestMasterSave("pilot-toggle", true)}
            open={masterDataStepActive && masterEditorOpen && masterDataCategory === "pilots"}
            submitAttempted={masterSubmitAttempted}
          />
          <ModalDialog
            className="master-discard-dialog"
            footer={
              <>
                <Button data-master-discard-continue onClick={continueMasterEditing} type="button">
                  Weiter bearbeiten
                </Button>
                <Button onClick={discardMasterChanges} type="button" variant="danger">
                  Verwerfen
                </Button>
              </>
            }
            initialFocusSelector="[data-master-discard-continue]"
            onClose={continueMasterEditing}
            open={discardMasterChangesOpen}
            role="alertdialog"
            size="compact"
            title="Änderungen verwerfen?"
          >
            <p className="master-discard-copy">
              Die noch nicht gespeicherten Änderungen gehen verloren. Dieser Vorgang kann nicht
              rückgängig gemacht werden.
            </p>
          </ModalDialog>
          {adminArea === "evaluation" ? (
            <AnalysisWorkspace
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
          ) : null}
          {adminArea === "events" && eventStep === "operational-plan" && board ? (
            <AdminOperationalPlanPanel
              board={board}
              busy={busyActionKey !== null}
              onMessage={setMessage}
              onRefresh={refresh}
              onRefreshHistory={refreshHistory}
              onRunBusyAction={runBusyAction}
              readOnly={!isAdministrator || !adminModeUnlocked}
            />
          ) : null}
          {adminArea === "events" && eventStep === "operations" && board ? (
            <AdminOperationsPanel
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
          ) : null}
          {adminArea === "events" && eventStep === "completion" && board ? (
            <section
              aria-labelledby="admin-event-step-completion-tab"
              id="admin-event-step-completion-panel"
              role="tabpanel"
            >
            <CompletionWorkspace
              board={board}
              onHistoryTabChange={changeHistoryView}
              summary={
                <AdminCompletionSummaryPanel
                  board={board}
                  busyActionKey={busyActionKey}
                  onMessage={setMessage}
                  onRunBusyAction={runBusyAction}
                />
              }
              history={
                <CompletionHistoryPanel
                  auditHistory={history}
                  board={board}
                  busyActionKey={busyActionKey}
                  filters={historyFilters}
                  forecastHistory={forecastHistory}
                  offset={historyOffset}
                  onApplyFilters={applyHistoryFilters}
                  onFilterChange={updateHistoryFilter}
                  onNextPage={() =>
                    runBusyAction("history-next", () =>
                      refreshDetailedHistory(historyOffset + 50),
                    )
                  }
                  onPreviousPage={() =>
                    runBusyAction("history-previous", () =>
                      refreshDetailedHistory(Math.max(0, historyOffset - 50)),
                    )
                  }
                  onResetFilters={resetHistoryFilters}
                  operationalHistory={operationalHistory}
                  view={historyView}
                />
              }
              corrections={
                <ManifestCorrectionPanel
                  administrator={isAdministrator}
                  board={board}
                  busy={busyActionKey === "manifest-correction"}
                  key={manifestCorrectionResetKey}
                  onCorrect={requestManifestCorrection}
                />
              }
            />
            </section>
          ) : null}
          <AdminAuthorizationDialog
            busy={adminPinBusy}
            error={adminPinError}
            inputRef={adminPinInputRef}
            mode={adminPinDialog}
            onClose={closeAdminPinDialog}
            onPinChange={setAdminPin}
            onSubmit={() => void confirmAdminPinDialog()}
            pin={adminPin}
          />
          <MasterDataDeleteDialog
            busy={busyActionKey === "master-delete"}
            eventStatus={board?.event.status}
            inputRef={adminPinInputRef}
            modeUnlocked={adminModeUnlocked}
            onCancel={cancelMasterDelete}
            onConfirm={() => void runBusyAction("master-delete", confirmMasterDelete)}
            onPinChange={setAdminPin}
            pin={adminPin}
            target={pendingMasterDelete}
          />
          <MasterDataTemplateImportDialog
            busy={templateImport.busy}
            draft={templateImport.draft}
            error={templateImport.error}
            fileName={templateImport.fileName}
            onClose={templateImport.closeDialog}
            onFile={(file) => void templateImport.readFile(file)}
            onImport={() => void templateImport.applyTemplate()}
            open={templateImport.open}
            validation={templateImport.validation}
          />
          <ConfirmationDialog
            body={
              <p>
                Die ungespeicherten Veranstaltungsparameter gehen beim Verlassen dieser Ansicht
                verloren.
              </p>
            }
            confirmLabel="Verwerfen und wechseln"
            danger
            onCancel={cancelPendingNavigation}
            onConfirm={confirmPendingNavigation}
            open={discardEventNavigationOpen}
            title="Ungespeicherte Änderungen verwerfen?"
          />
          <FactoryResetDialog
            busy={factoryResetState.busy}
            confirmation={factoryResetState.confirmation}
            deleteAllBackups={factoryResetState.deleteAllBackups}
            error={factoryResetState.error}
            onClose={factoryResetState.closeDialog}
            onConfirmationChange={factoryResetState.setConfirmation}
            onDeleteAllBackupsChange={factoryResetState.setDeleteAllBackups}
            onPinChange={factoryResetState.setPin}
            onReasonChange={factoryResetState.setReason}
            onRetainRecoveryBackupChange={factoryResetState.setRetainRecoveryBackup}
            onSubmit={() => void factoryResetState.performReset()}
            open={factoryResetState.open}
            pin={factoryResetState.pin}
            reason={factoryResetState.reason}
            retainRecoveryBackup={factoryResetState.retainRecoveryBackup}
          />
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
