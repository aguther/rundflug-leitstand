import type {
  AdminEventFlow,
  EventLogoTheme,
  MasterDataTemplate,
  MasterDataTemplateValidation,
  OperationBoard,
} from "@rundflug/contracts";
import { masterDataTemplateSchema } from "@rundflug/contracts";
import { ExternalLink, FlaskConical, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { hasMasterEditorChanges } from "./admin-master-editor-state";
import {
  type AdminArea,
  type AdminEventStep,
  AdminNavigation,
  type MasterDataCategory,
  SetupProgress,
  type SetupStep,
  ValidationHint,
} from "./admin-ux";
import {
  ApiCommandError,
  downloadDailyPdf,
  downloadDailyReport,
  downloadPerformanceProfile,
  downloadSimulationPlan,
  downloadTicketRawData,
  factoryReset,
  getAdminEventFlow,
  getPushConfiguration,
  getSetupStatus,
  importMasterDataTemplate,
  removeEventLogo,
  sendCommand,
  uploadEventLogo,
  validateMasterDataTemplate,
  verifyAdminPin,
} from "./api";
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
  AircraftProductTurnaroundOverrideDialog,
  type TurnaroundOverrideContext,
} from "./features/admin/aircraft/AircraftProductTurnaroundOverrideDialog";
import {
  type AircraftResourceGroupAssignmentContext,
  AircraftResourceGroupAssignmentDialog,
} from "./features/admin/aircraft/AircraftResourceGroupAssignmentDialog";
import { AircraftWorkspace } from "./features/admin/aircraft/AircraftWorkspace";
import { useAircraftEditorState } from "./features/admin/aircraft/useAircraftEditorState";
import { CompletionHistoryPanel } from "./features/admin/completion/CompletionHistoryPanel";
import { CompletionSummaryPanel } from "./features/admin/completion/CompletionSummaryPanel";
import { CompletionWorkspace } from "./features/admin/completion/CompletionWorkspace";
import { ManifestCorrectionPanel } from "./features/admin/completion/ManifestCorrectionPanel";
import { useAdminHistory } from "./features/admin/completion/useAdminHistory";
import {
  type EventParameterSaveLifecycle,
  EventParametersWorkspace,
} from "./features/admin/event-parameters/EventParametersWorkspace";
import type { ValidEventParameterPayload } from "./features/admin/event-parameters/useEventParametersForm";
import { EventCatalogDialog } from "./features/admin/event-workspace/EventCatalogDialog";
import { useAdminEventCatalog } from "./features/admin/event-workspace/useAdminEventCatalog";
import { useAdminEventWorkspaceNavigation } from "./features/admin/event-workspace/useAdminEventWorkspaceNavigation";
import { FactoryResetDialog } from "./features/admin/FactoryResetDialog";
import { GateEditorDialog } from "./features/admin/gates/GateEditorDialog";
import { GatesWorkspace } from "./features/admin/gates/GatesWorkspace";
import { useGateEditorState } from "./features/admin/gates/useGateEditorState";
import {
  MasterDataDeleteDialog,
  MasterDataTemplateImportDialog,
} from "./features/admin/master-data/MasterDataManagementDialogs";
import { MasterDataPagination } from "./features/admin/master-data/MasterDataPagination";
import {
  MasterDataEmptyState,
  MasterDataWorkspace,
} from "./features/admin/master-data/MasterDataWorkspace";
import { ResourceAircraftEditorDialog } from "./features/admin/master-data/ResourceAircraftEditorDialog";
import { AdminOperationalPlanPanel } from "./features/admin/operational-plan/AdminOperationalPlanPanel";
import { AdminOperationsPanel } from "./features/admin/operations/AdminOperationsPanel";
import { AdminAccessStatusBar } from "./features/admin/overview/AdminAccessStatusBar";
import {
  AdminOverviewPanel,
  type PushConfigurationStatus,
} from "./features/admin/overview/AdminOverviewPanel";
import { PilotCodesWorkspace } from "./features/admin/pilots/PilotCodesWorkspace";
import { PilotEditorDialog } from "./features/admin/pilots/PilotEditorDialog";
import { usePilotEditorState } from "./features/admin/pilots/usePilotEditorState";
import { ProductEditorDialog } from "./features/admin/products/ProductEditorDialog";
import { ProductSalesDialog } from "./features/admin/products/ProductSalesDialog";
import { ProductsWorkspace } from "./features/admin/products/ProductsWorkspace";
import { useProductEditorState } from "./features/admin/products/useProductEditorState";
import { ResourceGroupsWorkspace } from "./features/admin/resource-groups/ResourceGroupsWorkspace";
import { useResourceGroupEditorState } from "./features/admin/resource-groups/useResourceGroupEditorState";
import { AnalysisWorkspace } from "./features/analysis/AnalysisWorkspace";
import { AccountManagement } from "./features/auth/AccountManagement";
import { useAuth } from "./features/auth/AuthContext";
import { clearOfflineOperationBoards } from "./offline-store";
import {
  ADMIN_CONFIGURATION_AUDIT_REASON,
  ADMIN_DEVICE_ID,
  ConnectionNotice,
  deviceTokenFor,
  EmergencyNotice,
  EVENT_ID,
  InterruptionNotice,
  MASTER_DATA_AUDIT_REASON,
  MASTER_DATA_DELETE_REASON,
  type MasterDataDeleteTarget,
  OPERATIONAL_AUDIT_REASON,
  OperationalNotice,
  useOperationBoard,
} from "./operation-workspace";

const adminTableCollator = new Intl.Collator("de-DE", {
  numeric: true,
  sensitivity: "base",
});
const eventStepCopy: Record<AdminEventStep, { title: string; description: string }> = {
  event: {
    title: "Veranstaltung",
    description: "Grunddaten, Betriebszeiten und öffentliche Darstellung verwalten.",
  },
  gates: {
    title: "Gates",
    description: "Ausgabeorte, Reihenfolge und Displayfilter verwalten.",
  },
  "resource-groups": {
    title: "Ressourcengruppen",
    description: "Operative Queues, Kapazitäten und Flugzeugzuordnungen verwalten.",
  },
  aircraft: {
    title: "Flugzeuge",
    description: "Flotte, Sitzplätze und organisatorische Zuordnungen verwalten.",
  },
  pilots: {
    title: "Pilotencodes",
    description: "Anonyme operative Codes und Verfügbarkeit verwalten.",
  },
  products: {
    title: "Produkte",
    description: "Verkaufsprodukte, Preise und Queue-Zuordnung verwalten.",
  },
  "operational-plan": {
    title: "Betriebsplan",
    description: "Einschränkungen und wiederkehrende Regeln für den Flugtag planen.",
  },
  operations: {
    title: "Betrieb",
    description: "Betriebsfreigabe, Betriebsende und Notfallmodus verwalten.",
  },
  completion: {
    title: "Abschluss",
    description: "Betriebstag prüfen, Berichte exportieren und Verläufe auswerten.",
  },
};

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
  useEffect(() => {
    if (["gates", "resource-groups", "aircraft", "pilots", "products"].includes(eventStep)) {
      setMasterDataCategory(eventStep as MasterDataCategory);
      initialMasterEditorSnapshotRef.current = null;
      setDiscardMasterChangesOpen(false);
      setMasterSubmitAttempted(false);
      setMasterEditorOpen(false);
      setMasterSearch("");
    }
  }, [eventStep]);
  const [adminPin, setAdminPinState] = useState(session?.account.role === "ADMIN" ? "000000" : "");
  const adminPinRef = useRef(session?.account.role === "ADMIN" ? "000000" : "");
  const setAdminPin = useCallback((value: string) => {
    adminPinRef.current = value;
    setAdminPinState(value);
  }, []);
  const [adminModeUnlocked, setAdminModeUnlocked] = useState(session?.account.role === "ADMIN");
  const [adminPinDialog, setAdminPinDialog] = useState<"unlock" | "action" | null>(null);
  const [adminPinError, setAdminPinError] = useState<string | null>(null);
  const [adminPinBusy, setAdminPinBusy] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const pendingAdminActionRef = useRef<(() => Promise<void>) | null>(null);
  const adminPinInputRef = useRef<HTMLInputElement>(null);
  const [masterEditorOpen, setMasterEditorOpen] = useState(false);
  const [masterEditorTab, setMasterEditorTab] = useState<"general" | "details">("general");
  const [discardMasterChangesOpen, setDiscardMasterChangesOpen] = useState(false);
  const initialMasterEditorSnapshotRef = useRef<string | null>(null);
  const initialMasterSelectionRef = useRef(false);
  const [masterSubmitAttempted, setMasterSubmitAttempted] = useState(false);
  const [masterSearch, setMasterSearch] = useState("");
  const [masterSort, setMasterSort] = useState<{
    category: MasterDataCategory;
    key: string;
    direction: "asc" | "desc" | null;
  }>({ category: "resource-groups", key: "name", direction: null });
  const [masterPage, setMasterPage] = useState(0);
  const [masterPageSize, setMasterPageSize] = useState(10);
  const [resourceStatusFilter, setResourceStatusFilter] = useState("ALL");
  const [assignmentDialogContext, setAssignmentDialogContext] =
    useState<AircraftResourceGroupAssignmentContext | null>(null);
  const [turnaroundDialogContext, setTurnaroundDialogContext] =
    useState<TurnaroundOverrideContext | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing a filter or page size intentionally resets pagination
  useEffect(() => {
    setMasterPage(0);
  }, [masterDataCategory, masterSearch, masterPageSize, resourceStatusFilter]);
  const [pendingMasterDelete, setPendingMasterDelete] = useState<MasterDataDeleteTarget | null>(
    null,
  );
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
  const currentMasterEditorSnapshot =
    masterDataCategory === "gates"
      ? gateEditor.snapshot
      : masterDataCategory === "products"
        ? productEditor.snapshot
        : masterDataCategory === "resource-groups"
          ? resourceEditor.snapshot
          : masterDataCategory === "aircraft"
            ? aircraftEditor.snapshot
            : pilotEditor.snapshot;
  const masterEditorDirty =
    masterEditorOpen &&
    hasMasterEditorChanges(initialMasterEditorSnapshotRef.current, currentMasterEditorSnapshot);
  const [eventFlow, setEventFlow] = useState<AdminEventFlow | null>(null);
  const [eventFlowError, setEventFlowError] = useState<string | null>(null);
  const [eventFlowLoading, setEventFlowLoading] = useState(true);
  const [eventDialogView, setEventDialogView] = useState<"closed" | "catalog" | "create">("closed");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateFileName, setTemplateFileName] = useState("");
  const [templateDraft, setTemplateDraft] = useState<MasterDataTemplate | null>(null);
  const [templateValidation, setTemplateValidation] = useState<MasterDataTemplateValidation | null>(
    null,
  );
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [factoryResetOpen, setFactoryResetOpen] = useState(false);
  const [factoryResetBusy, setFactoryResetBusy] = useState(false);
  const [factoryResetError, setFactoryResetError] = useState<string | null>(null);
  const [factoryResetReason, setFactoryResetReason] = useState("");
  const [factoryResetPin, setFactoryResetPin] = useState("");
  const [factoryResetConfirmation, setFactoryResetConfirmation] = useState("");
  const [retainRecoveryBackup, setRetainRecoveryBackup] = useState(true);
  const [deleteAllBackups, setDeleteAllBackups] = useState(false);
  const [factoryResetCommandId, setFactoryResetCommandId] = useState(() => crypto.randomUUID());
  const resourceGroups = board?.resourceGroups ?? [];
  const isAdministrator = session?.account.role === "ADMIN" || board?.currentDeviceRole === "ADMIN";
  const productPriceCents = productEditor.priceCents;
  const eventVersion = board?.event.version;
  const eventCatalog = useAdminEventCatalog({
    administrator: isAdministrator,
    board,
    onMessage: setMessage,
    onViewChange: setEventDialogView,
    view: eventDialogView,
  });

  useEffect(() => {
    if (eventVersion === undefined || adminArea !== "overview" || !isAdministrator) return;
    const controller = new AbortController();
    setEventFlowLoading(true);
    setEventFlowError(null);
    void getAdminEventFlow(
      EVENT_ID,
      ADMIN_DEVICE_ID,
      deviceTokenFor(ADMIN_DEVICE_ID),
      controller.signal,
    )
      .then(setEventFlow)
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setEventFlowError(
            cause instanceof Error ? cause.message : "Ticketverlauf nicht verfügbar.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setEventFlowLoading(false);
      });
    return () => controller.abort();
  }, [adminArea, eventVersion, isAdministrator]);

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

  useEffect(() => {
    if (!adminPinDialog) return;
    const frame = window.requestAnimationFrame(() => adminPinInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [adminPinDialog]);

  useEffect(() => {
    if (session?.account.role !== "ADMIN") return;
    setAdminModeUnlocked(true);
    setAdminPin("000000");
  }, [session?.account.role, setAdminPin]);

  useEffect(() => {
    if (isAdministrator) return;
    setAdminModeUnlocked(false);
    setAdminPin("");
  }, [isAdministrator, setAdminPin]);
  async function exportSimulationPlan() {
    await downloadSimulationPlan(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID));
    setMessage("Stammdaten und offener Betriebsplan wurden für die Simulation exportiert.");
  }

  async function readMasterDataTemplate(file: File | null) {
    setTemplateDraft(null);
    setTemplateValidation(null);
    setTemplateError(null);
    setTemplateFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > 1_048_576) {
      setTemplateError("Die Vorlagendatei darf höchstens 1 MiB groß sein.");
      return;
    }
    setTemplateBusy(true);
    try {
      const parsedJson = JSON.parse(await file.text()) as unknown;
      const parsedTemplate = masterDataTemplateSchema.safeParse(parsedJson);
      if (!parsedTemplate.success) {
        throw new Error(parsedTemplate.error.issues[0]?.message ?? "Ungültige Vorlage.");
      }
      setTemplateDraft(parsedTemplate.data);
      const validation = await validateMasterDataTemplate(
        EVENT_ID,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        parsedTemplate.data,
      );
      setTemplateValidation(validation);
    } catch (cause) {
      setTemplateError(
        cause instanceof Error ? cause.message : "Die Vorlagendatei konnte nicht gelesen werden.",
      );
    } finally {
      setTemplateBusy(false);
    }
  }

  async function applyMasterDataTemplate() {
    if (
      !board ||
      !templateDraft ||
      !templateValidation?.valid ||
      !templateValidation.targetEligible
    ) {
      return;
    }
    setTemplateBusy(true);
    setTemplateError(null);
    try {
      const result = await importMasterDataTemplate(
        EVENT_ID,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        {
          commandId: crypto.randomUUID(),
          expectedVersion: board.event.version,
          template: templateDraft,
        },
      );
      setTemplateDialogOpen(false);
      setMessage(
        `Stammdatenvorlage importiert: ${result.counts.gates} Gates, ${result.counts.resourceGroups} Ressourcengruppen, ${result.counts.aircraft} Flugzeuge, ${result.counts.pilots} Pilotencodes und ${result.counts.products} Produkte.`,
      );
      await Promise.all([refresh(), eventCatalog.refreshEvents(), refreshHistory()]);
    } catch (cause) {
      setTemplateError(
        cause instanceof Error
          ? cause.message
          : "Stammdatenvorlage konnte nicht importiert werden.",
      );
    } finally {
      setTemplateBusy(false);
    }
  }

  function lockAdminMode(messageText = "Bearbeitungsmodus gesperrt.") {
    setAdminModeUnlocked(false);
    setAdminPin("");
    setAdminPinDialog(null);
    pendingAdminActionRef.current = null;
    setMessage(messageText);
  }

  function closeAdminPinDialog() {
    if (adminPinBusy) return;
    setAdminPinDialog(null);
    setAdminPinError(null);
    setAdminPin("");
    pendingAdminActionRef.current = null;
  }

  function requestAdminAction(action: () => Promise<void>): void | Promise<void> {
    if (!isAdministrator) {
      setMessage("Für diese Änderung wird ein Administrationskonto benötigt.");
      return;
    }
    if (
      session?.account.role === "ADMIN" ||
      (adminModeUnlocked && adminPinRef.current.length >= 4)
    ) {
      return action();
    }
    pendingAdminActionRef.current = action;
    setAdminPin("");
    setAdminPinError(null);
    setAdminPinDialog("action");
  }

  function requestAdminModeUnlock() {
    if (!isAdministrator) {
      setMessage("Der Bearbeitungsmodus ist nur mit einer Administrationssitzung verfügbar.");
      return;
    }
    if (session?.account.role === "ADMIN") {
      setAdminModeUnlocked(true);
      setAdminPin("000000");
      return;
    }
    pendingAdminActionRef.current = null;
    setAdminPin("");
    setAdminPinError(null);
    setAdminPinDialog("unlock");
  }

  async function confirmAdminPinDialog() {
    if (!adminPinDialog || adminPinBusy || adminPin.length < 4) return;
    setAdminPinBusy(true);
    setAdminPinError(null);
    try {
      await verifyAdminPin(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID), adminPin);
      if (adminPinDialog === "unlock") {
        setAdminModeUnlocked(true);
        setAdminPinDialog(null);
        setMessage("Bearbeitungsmodus aktiv. Mehrere Änderungen können gespeichert werden.");
        return;
      }
      const action = pendingAdminActionRef.current;
      pendingAdminActionRef.current = null;
      setAdminPinDialog(null);
      if (action) await action();
      setAdminPin("");
    } catch (cause) {
      setAdminPinError(
        cause instanceof Error ? cause.message : "Administrator-PIN konnte nicht geprüft werden.",
      );
      window.requestAnimationFrame(() => adminPinInputRef.current?.select());
    } finally {
      setAdminPinBusy(false);
    }
  }

  async function setEventLifecycle(status: "PREPARATION" | "ACTIVE" | "CLOSED" | "ARCHIVED") {
    if (!board || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_EVENT_LIFECYCLE",
          payload: {
            status,
            reason: ADMIN_CONFIGURATION_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(`Veranstaltungsstatus auf ${status} gesetzt und protokolliert.`);
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await eventCatalog.refreshEvents();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Statusänderung fehlgeschlagen.");
    }
  }

  function requestSaveEventParameters(
    payload: ValidEventParameterPayload,
    lifecycle: EventParameterSaveLifecycle,
  ) {
    void requestAdminAction(() =>
      runBusyAction("event-parameters", async () => {
        if (!board || adminPinRef.current.length < 4) return;
        try {
          await sendCommand(
            {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "CONFIGURE_EVENT_PARAMETERS",
              payload: {
                ...payload,
                reason: ADMIN_CONFIGURATION_AUDIT_REASON,
                adminPin: adminPinRef.current,
              },
            },
            deviceTokenFor(ADMIN_DEVICE_ID),
          );
          lifecycle.onSaved();
          setMessage("Veranstaltungsparameter wurden protokolliert aktualisiert.");
          if (!adminModeUnlocked) setAdminPin("");
          await Promise.all([refresh(), refreshHistory()]);
        } catch (cause) {
          if (
            cause instanceof ApiCommandError &&
            ["STALE_VERSION", "EVENT_VERSION_CONFLICT"].includes(cause.code)
          ) {
            lifecycle.onConflict(cause.currentVersion);
            await refresh();
          }
          setMessage(
            cause instanceof Error ? cause.message : "Parameter konnten nicht gespeichert werden.",
          );
        }
      }),
    );
  }

  function requestSaveEventLogo(theme: EventLogoTheme, file: File) {
    void requestAdminAction(() =>
      runBusyAction(`event-logo-${theme}`, () => saveEventLogo(theme, file)),
    );
  }

  async function saveEventLogo(theme: EventLogoTheme, file: File) {
    if (!board) return;
    try {
      await uploadEventLogo(
        EVENT_ID,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        board.event.version,
        theme,
        file,
      );
      setMessage(
        `Logo für das ${theme === "light" ? "helle" : "dunkle"} Theme gespeichert. Die Ansichten verwenden es nach dem Neuladen.`,
      );
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Logo konnte nicht gespeichert werden.");
    }
  }

  function requestClearEventLogo(theme: EventLogoTheme) {
    void requestAdminAction(() =>
      runBusyAction(`clear-event-logo-${theme}`, () => clearEventLogo(theme)),
    );
  }

  async function clearEventLogo(theme: EventLogoTheme) {
    if (!board) return;
    try {
      await removeEventLogo(
        EVENT_ID,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        board.event.version,
        theme,
      );
      setMessage(
        `Logo für das ${theme === "light" ? "helle" : "dunkle"} Theme entfernt. Fehlt die andere Variante ebenfalls, wird die Rundflug-Leitstand-Marke verwendet.`,
      );
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Logo konnte nicht entfernt werden.");
    }
  }

  function selectProductForEditing(id: string) {
    initialMasterEditorSnapshotRef.current = productEditor.select(id);
    setMasterSubmitAttempted(false);
    setMasterEditorTab("general");
    setMasterEditorOpen(true);
  }

  function selectGateForEditing(id: string) {
    initialMasterEditorSnapshotRef.current = gateEditor.select(id);
    setMasterSubmitAttempted(false);
    setMasterEditorTab("general");
    setMasterEditorOpen(true);
  }

  async function saveGate() {
    if (!board || gateEditor.label.trim().length < 2 || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_GATE",
          payload: {
            gateId: gateEditor.editorId === "new" ? crypto.randomUUID() : gateEditor.editorId,
            label: gateEditor.label.trim(),
            gateType: gateEditor.gateType,
            active: gateEditor.active,
            sortOrder: gateEditor.sortOrder,
            travelLeadMinutes: gateEditor.travelLeadMinutes,
            displayFilter: gateEditor.displayFilter,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Gate-Stammdaten wurden protokolliert gespeichert.");
      if (!adminModeUnlocked) setAdminPin("");
      finishMasterEditor();
      gateEditor.resetAfterSave();
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Gate konnte nicht gespeichert werden.");
    }
  }

  async function correctRotationManifest(
    ticketGroupId: string,
    targetRotationId: string,
    correctionReason: string,
  ) {
    if (
      !board ||
      !ticketGroupId ||
      !targetRotationId ||
      correctionReason.trim().length < 10 ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CORRECT_ROTATION_MANIFEST",
          payload: {
            ticketGroupId,
            targetRotationId,
            reason: correctionReason.trim(),
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setManifestCorrectionResetKey((current) => current + 1);
      setMessage("Dokumentierte Besetzung wurde als Admin-Korrektur vollständig auditiert.");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Manifestkorrektur konnte nicht gespeichert werden.",
      );
    }
  }

  async function saveProduct() {
    if (
      !board ||
      !productEditor.resourceGroupId ||
      !productEditor.gateId ||
      productPriceCents === null ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_PRODUCT",
          payload: {
            productId:
              productEditor.editorId === "new" ? crypto.randomUUID() : productEditor.editorId,
            resourceGroupId: productEditor.resourceGroupId,
            gateId: productEditor.gateId,
            name: productEditor.name.trim(),
            code: productEditor.code.trim().toUpperCase(),
            publicDescription: productEditor.description.trim(),
            priceCents: productPriceCents,
            referenceCapacity:
              resourceGroups.find((group) => group.id === productEditor.resourceGroupId)
                ?.referenceCapacity ?? 1,
            referenceDurationMinutes: productEditor.referenceDuration,
            promisedFlightMinutes: productEditor.promisedFlightMinutes,
            plannedBoardingMinutesOverride:
              productEditor.boardingOverride === "" ? null : Number(productEditor.boardingOverride),
            plannedDeboardingMinutesOverride:
              productEditor.deboardingOverride === ""
                ? null
                : Number(productEditor.deboardingOverride),
            plannedBufferMinutesOverride:
              productEditor.bufferOverride === "" ? null : Number(productEditor.bufferOverride),
            childCompanionRequired: productEditor.childCompanion,
            weightClasses: productEditor.weightClasses,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Produktstammdaten wurden protokolliert gespeichert.");
      if (!adminModeUnlocked) setAdminPin("");
      selectProductForEditing("new");
      finishMasterEditor();
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Produkt konnte nicht gespeichert werden.",
      );
    }
  }

  async function persistAircraftProductTurnaroundOverride(
    aircraftId: string,
    productId: string,
    values: { boarding: number | null; deboarding: number | null; buffer: number | null },
  ) {
    if (!board) return;
    const existing = board.aircraftProductTurnaroundOverrides.find(
      (override) => override.productId === productId && override.aircraftId === aircraftId,
    );
    const inheritAll =
      values.boarding === null && values.deboarding === null && values.buffer === null;
    if (inheritAll && !existing) return;
    try {
      await sendCommand(
        inheritAll && existing
          ? {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "DELETE_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE",
              payload: {
                aircraftId,
                productId,
                expectedOverrideVersion: existing.version,
                reason: MASTER_DATA_AUDIT_REASON,
                adminPin: adminPinRef.current,
              },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "UPSERT_AIRCRAFT_PRODUCT_TURNAROUND_OVERRIDE",
              payload: {
                aircraftId,
                productId,
                plannedBoardingMinutesOverride: values.boarding,
                plannedDeboardingMinutesOverride: values.deboarding,
                plannedBufferMinutesOverride: values.buffer,
                expectedOverrideVersion: existing?.version ?? 0,
                reason: MASTER_DATA_AUDIT_REASON,
                adminPin: adminPinRef.current,
              },
            },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(
        inheritAll
          ? "Die Bodenzeiten erben wieder unmittelbar von Produkt oder Veranstaltung."
          : "Flugzeugspezifische Bodenzeiten wurden protokolliert gespeichert.",
      );
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Flugzeugspezifische Bodenzeiten konnten nicht gespeichert werden.",
      );
    }
  }

  function requestTurnaroundOverrideSave(
    aircraftId: string,
    productId: string,
    values: { boarding: number | null; deboarding: number | null; buffer: number | null },
  ) {
    if (!isAdministrator) {
      setMessage("Für Änderungen am Zeitmodell wird ein Administrationskonto benötigt.");
      return;
    }
    requestAdminAction(() =>
      runBusyAction(`turnaround-${aircraftId}-${productId}`, () =>
        persistAircraftProductTurnaroundOverride(aircraftId, productId, values),
      ),
    );
  }

  function requestAircraftAssignment(aircraftId: string, resourceGroupId: string) {
    if (!isAdministrator) {
      setMessage("Für Flugzeugzuordnungen wird ein Administrationskonto benötigt.");
      return;
    }
    requestAdminAction(() =>
      runBusyAction("master-assignment", () => assignAircraft(aircraftId, resourceGroupId)),
    );
  }

  function selectResourceForEditing(id: string) {
    initialMasterEditorSnapshotRef.current = resourceEditor.select(id);
    setMasterSubmitAttempted(false);
    setMasterEditorOpen(true);
  }

  function selectAircraftForEditing(id: string) {
    initialMasterEditorSnapshotRef.current = aircraftEditor.select(id);
    setMasterSubmitAttempted(false);
    setMasterEditorOpen(true);
  }

  async function saveResourceGroup() {
    if (
      !board ||
      !resourceEditor.gateId ||
      resourceEditor.name.trim().length < 2 ||
      !/^[A-Z0-9-]{2,8}$/.test(resourceEditor.shortCode.trim().toUpperCase()) ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      const resourceGroupId =
        resourceEditor.editorId === "new" ? crypto.randomUUID() : resourceEditor.editorId;
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_RESOURCE_GROUP",
          payload: {
            resourceGroupId,
            name: resourceEditor.name.trim(),
            shortCode: resourceEditor.shortCode.trim().toUpperCase(),
            gateId: resourceEditor.gateId,
            referenceCapacity: resourceEditor.currentGroup?.referenceCapacity ?? 1,
            compatibleAircraftTypes: [],
            automaticPrecallEnabled: resourceEditor.automaticPrecall,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(
        "Ressourcengruppe wurde protokolliert gespeichert; Zuordnungen bleiben unverändert.",
      );
      if (!adminModeUnlocked) setAdminPin("");
      selectResourceForEditing("new");
      finishMasterEditor();
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Ressourcengruppe konnte nicht gespeichert werden.",
      );
    }
  }

  async function saveAircraft() {
    if (
      !board ||
      aircraftEditor.registration.trim().length < 3 ||
      aircraftEditor.type.trim().length < 2 ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_AIRCRAFT",
          payload: {
            aircraftId:
              aircraftEditor.editorId === "new" ? crypto.randomUUID() : aircraftEditor.editorId,
            registration: aircraftEditor.registration.trim().toUpperCase(),
            aircraftType: aircraftEditor.type.trim(),
            passengerSeats: aircraftEditor.passengerSeats,
            maximumPassengerPayloadKg: aircraftEditor.maximumPassengerPayloadKg
              ? Number(aircraftEditor.maximumPassengerPayloadKg)
              : null,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Flugzeugstammdaten wurden protokolliert gespeichert.");
      if (!adminModeUnlocked) setAdminPin("");
      selectAircraftForEditing("new");
      finishMasterEditor();
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeug konnte nicht gespeichert werden.",
      );
    }
  }

  async function assignAircraft(aircraftId: string, resourceGroupId: string) {
    if (!board || !aircraftId || !resourceGroupId || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "ASSIGN_AIRCRAFT_RESOURCE_GROUP",
          payload: {
            aircraftId,
            resourceGroupId,
            effectiveAt: new Date().toISOString(),
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(
        "Flugzeugzuordnung wurde historisiert geändert; Queue und Prognose werden neu berechnet.",
      );
      if (!adminModeUnlocked) setAdminPin("");
      setAssignmentDialogContext(null);
      finishMasterEditor();
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeugzuordnung konnte nicht geändert werden.",
      );
    }
  }

  async function emergency(
    type: "TRIGGER_EMERGENCY" | "CLEAR_EMERGENCY",
    emergencyReason: string,
  ): Promise<boolean> {
    if (
      !board ||
      emergencyReason.trim().length < 3 ||
      (type === "CLEAR_EMERGENCY" && adminPinRef.current.length < 4)
    )
      return false;
    try {
      await sendCommand(
        type === "TRIGGER_EMERGENCY"
          ? {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type,
              payload: { reason: emergencyReason.trim() },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type,
              payload: { reason: emergencyReason.trim(), adminPin: adminPinRef.current },
            },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(
        type === "TRIGGER_EMERGENCY" ? "Notfallmodus ausgelöst." : "Notfallmodus aufgehoben.",
      );
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
      return true;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Notfallkommando fehlgeschlagen.");
      return false;
    }
  }

  async function configureProductSales(
    product: OperationBoard["products"][number],
    saleEnabled: boolean,
    closingTimeOverride?: string | null,
  ) {
    if (!board || adminPinRef.current.length < 4) return;
    try {
      const configuredClosing =
        closingTimeOverride === undefined ? product.saleClosesAt : closingTimeOverride;
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CONFIGURE_PRODUCT_SALES",
          payload: {
            productId: product.id,
            saleEnabled,
            saleClosesAt: configuredClosing,
            warningThreshold: product.capacityWarningThreshold,
            criticalThreshold: product.capacityCriticalThreshold,
            reason: OPERATIONAL_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Verkaufssteuerung wurde protokolliert aktualisiert.");
      setSalesProductId(null);
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Verkaufssteuerung fehlgeschlagen.");
    }
  }

  async function upsertPilot(
    pilotId: string,
    operationalCode: string,
    operationalNote: string,
    active: boolean,
  ) {
    if (!board || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_PILOT",
          payload: {
            pilotId,
            operationalCode: operationalCode.trim().toUpperCase(),
            operationalNote: operationalNote.trim(),
            active,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Anonymer operativer Pilotencode wurde aktualisiert.");
      if (!adminModeUnlocked) setAdminPin("");
      pilotEditor.resetAfterSave();
      finishMasterEditor();
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Pilotencode konnte nicht geändert werden.",
      );
    }
  }

  function selectPilotForEditing(id: string) {
    initialMasterEditorSnapshotRef.current = pilotEditor.select(id);
    setMasterSubmitAttempted(false);
    setMasterEditorOpen(true);
  }

  async function exportDailyReport() {
    try {
      await downloadDailyReport(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID));
      setMessage("Tagesbericht wurde erzeugt.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Tagesbericht fehlgeschlagen.");
    }
  }

  async function exportDailyPdf() {
    try {
      await downloadDailyPdf(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID));
      setMessage("PDF-Tagesbericht wurde erzeugt.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "PDF-Tagesbericht fehlgeschlagen.");
    }
  }

  async function exportRawData() {
    try {
      await downloadTicketRawData(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID));
      setMessage("Ticket-Rohdaten wurden exportiert.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Rohdatenexport fehlgeschlagen.");
    }
  }

  async function exportPerformanceProfile() {
    try {
      await downloadPerformanceProfile(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID));
      setMessage("Kontextbezogenes Leistungsprofil wurde exportiert.");
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Leistungsprofil konnte nicht exportiert werden.",
      );
    }
  }

  function requestMasterSave(
    action: "gate" | "resource-group" | "aircraft" | "pilot" | "pilot-toggle" | "product",
    valid: boolean,
    invalidFieldId?: string,
  ) {
    setMasterSubmitAttempted(true);
    if (!isAdministrator) {
      setMessage("Für Stammdatenänderungen wird ein Administrationskonto benötigt.");
      return;
    }
    if (!valid) {
      if (invalidFieldId) {
        window.requestAnimationFrame(() => document.getElementById(invalidFieldId)?.focus());
      }
      return;
    }
    requestAdminAction(() =>
      runBusyAction(`master-${action}`, async () => {
        if (action === "gate") await saveGate();
        if (action === "resource-group") await saveResourceGroup();
        if (action === "aircraft") await saveAircraft();
        if (action === "product") await saveProduct();
        if (action === "pilot") {
          await upsertPilot(
            pilotEditor.editorId === "new" ? crypto.randomUUID() : pilotEditor.editorId,
            pilotEditor.code,
            pilotEditor.note,
            pilotEditor.currentPilot?.active ?? true,
          );
        }
        if (action === "pilot-toggle") {
          const existing = pilotEditor.currentPilot;
          if (existing) {
            await upsertPilot(
              existing.id,
              existing.operationalCode,
              existing.operationalNote,
              !existing.active,
            );
          }
        }
      }),
    );
  }

  function requestProductSave() {
    setMasterSubmitAttempted(true);
    const invalidFieldId =
      productEditor.name.trim().length < 2
        ? "product-name"
        : !/^[A-Z0-9-]{2,12}$/.test(productEditor.code)
          ? "product-code"
          : productPriceCents === null
            ? "product-price"
            : !productEditor.resourceGroupId
              ? "product-resource-group"
              : !productEditor.gateId
                ? "product-gate"
                : null;
    if (invalidFieldId) {
      window.requestAnimationFrame(() => document.getElementById(invalidFieldId)?.focus());
      return;
    }
    requestMasterSave("product", true);
  }

  function finishMasterEditor() {
    initialMasterEditorSnapshotRef.current = null;
    setDiscardMasterChangesOpen(false);
    setMasterSubmitAttempted(false);
    setMasterEditorOpen(false);
  }

  function requestMasterEditorClose() {
    if (masterEditorDirty) {
      setMasterEditorOpen(false);
      setDiscardMasterChangesOpen(true);
      return;
    }
    finishMasterEditor();
  }

  function continueMasterEditing() {
    setDiscardMasterChangesOpen(false);
    setMasterEditorOpen(true);
  }

  function discardMasterChanges() {
    finishMasterEditor();
  }

  function requestCurrentMasterSave() {
    if (masterDataCategory === "gates") {
      requestMasterSave("gate", gateEditor.label.trim().length >= 2, "gate-label");
      return;
    }
    if (masterDataCategory === "products") {
      requestProductSave();
      return;
    }
    if (masterDataCategory === "resource-groups") {
      const invalidFieldId =
        resourceEditor.name.trim().length < 2
          ? "resource-name"
          : !/^[A-Z0-9-]{2,8}$/.test(resourceEditor.shortCode.trim().toUpperCase())
            ? "resource-short-code"
            : !resourceEditor.gateId
              ? "resource-gate"
              : undefined;
      requestMasterSave("resource-group", !invalidFieldId, invalidFieldId);
      return;
    }
    if (masterDataCategory === "aircraft") {
      const invalidFieldId =
        aircraftEditor.registration.trim().length < 3
          ? "aircraft-registration"
          : aircraftEditor.type.trim().length < 2
            ? "aircraft-type"
            : undefined;
      requestMasterSave("aircraft", !invalidFieldId, invalidFieldId);
      return;
    }
    requestMasterSave(
      "pilot",
      /^[A-Z0-9-]{2,12}$/.test(pilotEditor.code),
      "pilot-operational-code",
    );
  }

  function openFactoryReset() {
    setFactoryResetCommandId(crypto.randomUUID());
    setFactoryResetError(null);
    setMessage(null);
    setFactoryResetReason("");
    setFactoryResetPin("");
    setFactoryResetConfirmation("");
    setRetainRecoveryBackup(true);
    setDeleteAllBackups(false);
    setFactoryResetOpen(true);
  }

  async function performFactoryReset() {
    if (
      factoryResetBusy ||
      factoryResetReason.trim().length < 3 ||
      !/^\d{6,12}$/.test(factoryResetPin) ||
      factoryResetConfirmation !== "WERKSZUSTAND"
    )
      return;
    setFactoryResetBusy(true);
    setFactoryResetError(null);
    try {
      const result = await factoryReset(
        EVENT_ID,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        {
          commandId: factoryResetCommandId,
          eventId: EVENT_ID,
          reason: factoryResetReason.trim(),
          adminPin: factoryResetPin,
          confirmation: "WERKSZUSTAND",
          retainRecoveryBackup,
          deleteAllBackups,
        },
      );
      if (result.resetComplete) {
        await clearOfflineOperationBoards();
        try {
          // `ready` remains pending forever when this browser has no active PWA registration
          // (for example during the initial local setup). Reset cleanup must never block the
          // mandatory redirect back to /setup.
          const registration = await navigator.serviceWorker?.getRegistration();
          const subscription = await registration?.pushManager.getSubscription();
          await subscription?.unsubscribe();
        } catch {
          // Der Serverzustand ist bereits gelöscht; lokale Push-Bereinigung ist best effort.
        }
        window.localStorage.clear();
        window.location.replace("/setup");
      }
    } catch (cause) {
      setFactoryResetError(
        cause instanceof Error ? cause.message : "Werkszustand konnte nicht hergestellt werden.",
      );
      setFactoryResetBusy(false);
    }
  }

  const setupSteps: SetupStep[] = [
    {
      id: "event",
      label: "Veranstaltung",
      complete: Boolean(
        board &&
          (board.event.status !== "PREPARATION" ||
            (board.event.saleOpensAt && board.event.operationsEndAt)),
      ),
    },
    {
      id: "gates",
      label: "Gates",
      complete: Boolean(board?.gates.some((gate) => gate.active)),
      category: "gates",
    },
    {
      id: "resource-groups",
      label: "Ressourcengruppen",
      complete: Boolean(
        board?.resourceGroups.length &&
          board.resourceGroups.every((group) => group.activeAircraftIds.length > 0),
      ),
      category: "resource-groups",
    },
    {
      id: "aircraft",
      label: "Flugzeuge",
      complete: Boolean(board?.aircraft.length),
      category: "aircraft",
    },
    {
      id: "pilots",
      label: "Pilotencodes",
      complete: Boolean(board?.pilots.some((pilot) => pilot.active)),
      category: "pilots",
    },
    {
      id: "products",
      label: "Produkte",
      complete: Boolean(board?.products.length),
      category: "products",
    },
    {
      id: "operational-plan",
      label: "Betriebsplan",
      complete: Boolean(
        board?.plannedOperations.length ||
          board?.recurringOperationalRules.some((rule) => rule.status === "ACTIVE"),
      ),
    },
    {
      id: "operations",
      label: "Betrieb",
      complete: board?.event.status === "CLOSED" || board?.event.status === "ARCHIVED",
    },
    {
      id: "completion",
      label: "Abschluss",
      complete: board?.event.status === "ARCHIVED",
    },
  ];
  const setupComplete = setupSteps.slice(0, 6).every((step) => step.complete);
  const completedSetupSteps = setupSteps.slice(0, 6).filter((step) => step.complete).length;
  const adminAreaCopy: Record<AdminArea, { title: string; description: string }> = {
    overview: {
      title: "Übersicht",
      description: "Betriebsstatus, Kennzahlen und offene organisatorische Aufgaben.",
    },
    events: {
      title: "Veranstaltungen",
      description: "Veranstaltung auswählen, vorbereiten, betreiben und abschließen.",
    },
    users: {
      title: "Konten",
      description: "Pseudonyme Arbeitskonten, Rollen und Sitzungen verwalten.",
    },
    evaluation: {
      title: "Auswertung",
      description: "Synthetische Prognoseszenarien im Simulator untersuchen.",
    },
    backup: {
      title: "Sicherung & Reset",
      description: "Daten gezielt bereinigen oder das System vollständig neu einrichten.",
    },
  };

  function startNewMasterDataEntry() {
    if (masterDataCategory === "gates") selectGateForEditing("new");
    if (masterDataCategory === "resource-groups") selectResourceForEditing("new");
    if (masterDataCategory === "aircraft") selectAircraftForEditing("new");
    if (masterDataCategory === "pilots") selectPilotForEditing("new");
    if (masterDataCategory === "products") selectProductForEditing("new");
  }

  function masterDataDeletionBlockers(
    entityType: MasterDataDeleteTarget["entityType"],
    entityId: string,
  ): string[] {
    if (!board) return ["Der bestätigte Betriebsstand wird noch geladen"];
    if (entityType === "GATE") {
      const groups = resourceGroups.filter((group) => group.gateId === entityId).length;
      const products = board.products.filter((product) => product.gateId === entityId).length;
      const rotations = board.rotations.filter((rotation) => rotation.gateId === entityId).length;
      return [
        ...(groups ? [`${groups} Ressourcengruppe(n)`] : []),
        ...(products ? [`${products} Produkt(e)`] : []),
        ...(rotations ? [`${rotations} Umlauf/Umläufe`] : []),
      ];
    }
    if (entityType === "RESOURCE_GROUP") {
      const products = board.products.filter(
        (product) => product.resourceGroupId === entityId,
      ).length;
      const assignments = board.aircraft.filter(
        (aircraft) => aircraft.resourceGroupId === entityId,
      ).length;
      return [
        ...(products ? [`${products} Produkt(e)`] : []),
        ...(assignments ? [`${assignments} Flugzeugzuordnung(en)`] : []),
      ];
    }
    if (entityType === "PRODUCT") {
      const code = board.products.find((product) => product.id === entityId)?.code;
      const rotations = board.rotations.filter((rotation) => rotation.productCode === code).length;
      return rotations ? [`${rotations} Umlauf/Umläufe`] : [];
    }
    if (entityType === "AIRCRAFT") {
      const aircraft = board.aircraft.find((entry) => entry.id === entityId);
      const rotations = board.rotations.filter(
        (rotation) => rotation.aircraftId === entityId,
      ).length;
      return [
        ...(aircraft?.resourceGroupId ? ["1 Flugzeugzuordnung"] : []),
        ...(rotations ? [`${rotations} Umlauf/Umläufe`] : []),
      ];
    }
    if (entityType === "PILOT") {
      const pilot = board.pilots.find((entry) => entry.id === entityId);
      const aircraft = board.aircraft.filter((entry) => entry.currentPilotId === entityId).length;
      return [
        ...(pilot?.currentRotationId ? ["1 aktiver Umlauf"] : []),
        ...(aircraft ? [`${aircraft} Flugzeugbindung(en)`] : []),
      ];
    }
    const rotations = board.rotations.filter((rotation) => rotation.aircraftId === entityId).length;
    return rotations ? [`${rotations} Umlauf/Umläufe`] : [];
  }

  function requestMasterDelete(
    entityType: MasterDataDeleteTarget["entityType"],
    entityId: string,
    label: string,
  ) {
    if (!adminModeUnlocked) setAdminPin("");
    setPendingMasterDelete({
      entityType,
      entityId,
      label,
      blockers: masterDataDeletionBlockers(entityType, entityId),
    });
    setMasterEditorOpen(false);
  }

  function cancelMasterDelete() {
    setPendingMasterDelete(null);
    setMasterEditorOpen(true);
  }

  async function confirmMasterDelete() {
    if (
      !board ||
      !pendingMasterDelete ||
      pendingMasterDelete.blockers.length > 0 ||
      board.event.status !== "PREPARATION" ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "DELETE_MASTER_DATA",
          payload: {
            entityType: pendingMasterDelete.entityType,
            entityId: pendingMasterDelete.entityId,
            reason: MASTER_DATA_DELETE_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(`${pendingMasterDelete.label} wurde gelöscht und die Löschung protokolliert.`);
      setPendingMasterDelete(null);
      finishMasterEditor();
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Stammdatensatz konnte nicht gelöscht werden.",
      );
    }
  }

  function sortMasterRows<T extends { id: string }>(
    category: MasterDataCategory,
    rows: readonly T[],
    valueFor: (row: T, key: string) => string | number,
  ): T[] {
    if (masterSort.category !== category || masterSort.direction === null) return [...rows];
    return rows.toSorted((left, right) => {
      const leftValue = valueFor(left, masterSort.key);
      const rightValue = valueFor(right, masterSort.key);
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : adminTableCollator.compare(String(leftValue), String(rightValue));
      return masterSort.direction === "asc" ? comparison : -comparison;
    });
  }

  function toggleMasterSort(key: string) {
    setMasterSort((current) =>
      current.category === masterDataCategory && current.key === key
        ? {
            ...current,
            direction:
              current.direction === "asc" ? "desc" : current.direction === "desc" ? null : "asc",
          }
        : { category: masterDataCategory, key, direction: "asc" },
    );
  }

  const normalizedMasterSearch = masterSearch.trim().toLocaleLowerCase("de-DE");
  const alphabeticalProducts = (board?.products ?? []).toSorted(
    (left, right) =>
      adminTableCollator.compare(left.name, right.name) ||
      adminTableCollator.compare(left.code, right.code),
  );
  const visibleGates = sortMasterRows(
    "gates",
    (board?.gates ?? []).filter((gate) =>
      `${gate.label} ${gate.gateType}`.toLocaleLowerCase("de-DE").includes(normalizedMasterSearch),
    ),
    (gate, key) =>
      key === "status"
        ? Number(gate.active)
        : key === "sortOrder"
          ? gate.sortOrder
          : key === "type"
            ? gate.gateType
            : gate.label,
  );
  const visibleResourceGroups = sortMasterRows(
    "resource-groups",
    resourceGroups.filter(
      (group) =>
        (resourceStatusFilter === "ALL" || group.status === resourceStatusFilter) &&
        `${group.name} ${group.shortCode} ${group.gateLabel}`
          .toLocaleLowerCase("de-DE")
          .includes(normalizedMasterSearch),
    ),
    (group, key) =>
      key === "status"
        ? group.status
        : key === "gate"
          ? group.gateLabel
          : key === "capacity"
            ? group.referenceCapacity
            : key === "aircraft"
              ? group.activeAircraftIds.length
              : group.name,
  );
  const visibleAircraft = sortMasterRows(
    "aircraft",
    (board?.aircraft ?? []).filter((aircraft) =>
      `${aircraft.registration} ${aircraft.aircraftType} ${aircraft.resourceGroupName}`
        .toLocaleLowerCase("de-DE")
        .includes(normalizedMasterSearch),
    ),
    (aircraft, key) =>
      key === "type"
        ? aircraft.aircraftType
        : key === "seats"
          ? aircraft.passengerSeats
          : key === "group"
            ? aircraft.resourceGroupName
            : key === "pilot"
              ? (aircraft.currentPilotOperationalCode ?? "")
              : key === "status"
                ? aircraft.operationalState
                : aircraft.registration,
  );
  const visiblePilots = sortMasterRows(
    "pilots",
    (board?.pilots ?? []).filter((pilot) =>
      `${pilot.operationalCode} ${pilot.operationalNote}`
        .toLocaleLowerCase("de-DE")
        .includes(normalizedMasterSearch),
    ),
    (pilot, key) =>
      key === "note"
        ? pilot.operationalNote
        : key === "status"
          ? Number(pilot.active) + Number(pilot.paused)
          : key === "rotation"
            ? (pilot.currentCommunicationNumber ?? 0)
            : pilot.operationalCode,
  );
  const visibleProducts = sortMasterRows(
    "products",
    alphabeticalProducts.filter((product) =>
      `${product.code} ${product.name} ${product.resourceGroupName} ${product.gateLabel}`
        .toLocaleLowerCase("de-DE")
        .includes(normalizedMasterSearch),
    ),
    (product, key) =>
      key === "name"
        ? product.name
        : key === "group"
          ? product.resourceGroupName
          : key === "gate"
            ? product.gateLabel
            : key === "price"
              ? product.priceCents
              : key === "duration"
                ? product.referenceDurationMinutes
                : key === "status"
                  ? Number(product.saleEnabled)
                  : product.code,
  );
  const activeMasterDataRows: { id: string }[] =
    masterDataCategory === "gates"
      ? visibleGates
      : masterDataCategory === "resource-groups"
        ? visibleResourceGroups
        : masterDataCategory === "aircraft"
          ? visibleAircraft
          : masterDataCategory === "pilots"
            ? visiblePilots
            : visibleProducts;
  const totalMasterDataCount =
    masterDataCategory === "gates"
      ? (board?.gates.length ?? 0)
      : masterDataCategory === "resource-groups"
        ? resourceGroups.length
        : masterDataCategory === "aircraft"
          ? (board?.aircraft.length ?? 0)
          : masterDataCategory === "pilots"
            ? (board?.pilots.length ?? 0)
            : (board?.products.length ?? 0);
  const masterPageCount = Math.max(1, Math.ceil(activeMasterDataRows.length / masterPageSize));
  const masterPageClamped = Math.min(masterPage, masterPageCount - 1);
  const masterPageStart = masterPageClamped * masterPageSize;
  const masterPageEnd = masterPageStart + masterPageSize;
  const pagedGates = visibleGates.slice(masterPageStart, masterPageEnd);
  const pagedResourceGroups = visibleResourceGroups.slice(masterPageStart, masterPageEnd);
  const pagedAircraft = visibleAircraft.slice(masterPageStart, masterPageEnd);
  const pagedPilots = visiblePilots.slice(masterPageStart, masterPageEnd);
  const pagedProducts = visibleProducts.slice(masterPageStart, masterPageEnd);
  const masterDataSingularLabel: Record<MasterDataCategory, string> = {
    gates: "Gate",
    "resource-groups": "Ressourcengruppe",
    aircraft: "Flugzeug",
    assignments: "Flugzeug",
    pilots: "Pilotencode",
    products: "Produkt",
  };
  const masterDataPluralLabel: Record<MasterDataCategory, string> = {
    gates: "Gates",
    "resource-groups": "Ressourcengruppen",
    aircraft: "Flugzeuge",
    assignments: "Flugzeuge",
    pilots: "Pilotencodes",
    products: "Produkte",
  };
  const masterDataEmptyState = (
    <MasterDataEmptyState
      description={
        totalMasterDataCount === 0
          ? "Für diese Veranstaltung sind noch keine Einträge vorhanden."
          : "Die aktuelle Suche oder Filterauswahl liefert keine Einträge."
      }
      title={
        totalMasterDataCount === 0
          ? `Noch keine ${masterDataPluralLabel[masterDataCategory]}`
          : "Keine Treffer"
      }
    />
  );
  const masterDataStepActive =
    adminArea === "events" &&
    ["gates", "resource-groups", "aircraft", "pilots", "products"].includes(eventStep);
  const masterEditorDeleteAction: {
    entityType: MasterDataDeleteTarget["entityType"];
    entityId: string;
    label: string;
    description: string;
  } | null =
    masterDataCategory === "gates" && gateEditor.editorId !== "new"
      ? {
          entityType: "GATE",
          entityId: gateEditor.editorId,
          label: gateEditor.label,
          description: "Nur in der Vorbereitung und ohne operative Verwendung möglich.",
        }
      : masterDataCategory === "resource-groups" && resourceEditor.editorId !== "new"
        ? {
            entityType: "RESOURCE_GROUP",
            entityId: resourceEditor.editorId,
            label: resourceEditor.name,
            description: "Produkte und Flugzeugzuordnungen müssen vorher entfernt sein.",
          }
        : masterDataCategory === "aircraft" && aircraftEditor.editorId !== "new"
          ? {
              entityType: "AIRCRAFT",
              entityId: aircraftEditor.editorId,
              label: aircraftEditor.registration,
              description: "Eine bestehende Zuordnung muss zuerst entfernt werden.",
            }
          : masterDataCategory === "pilots" && pilotEditor.editorId !== "new"
            ? {
                entityType: "PILOT",
                entityId: pilotEditor.editorId,
                label: pilotEditor.code,
                description: "Nur ohne Umlauf oder Flugzeugbindung möglich.",
              }
            : masterDataCategory === "products" && productEditor.editorId !== "new"
              ? {
                  entityType: "PRODUCT",
                  entityId: productEditor.editorId,
                  label: productEditor.name,
                  description: "Nur ohne Tickets oder Umläufe möglich.",
                }
              : null;
  const masterEditorBusyKey =
    masterDataCategory === "gates"
      ? "master-gate"
      : masterDataCategory === "resource-groups"
        ? "master-resource-group"
        : masterDataCategory === "aircraft"
          ? "master-aircraft"
          : masterDataCategory === "pilots"
            ? "master-pilot"
            : "master-product";
  const masterEditorInitialFocusSelector =
    masterDataCategory === "gates"
      ? "#gate-label"
      : masterDataCategory === "resource-groups"
        ? "#resource-name"
        : masterDataCategory === "aircraft"
          ? "#aircraft-registration"
          : masterDataCategory === "pilots"
            ? "#pilot-operational-code"
            : "#product-name";
  const masterEditorFooter = (
    <>
      {masterEditorDeleteAction ? (
        <Button
          className="master-editor-delete-footer"
          disabled={!isAdministrator}
          onClick={() =>
            requestMasterDelete(
              masterEditorDeleteAction.entityType,
              masterEditorDeleteAction.entityId,
              masterEditorDeleteAction.label,
            )
          }
          type="button"
          variant="danger"
        >
          <Trash2 aria-hidden="true" />
          Löschen
        </Button>
      ) : null}
      <div className="master-editor-standard-actions">
        <Button onClick={requestMasterEditorClose} type="button">
          Abbrechen
        </Button>
        <Button
          busy={busyActionKey === masterEditorBusyKey}
          disabled={!isAdministrator}
          onClick={requestCurrentMasterSave}
          type="button"
          variant="primary"
        >
          Speichern
        </Button>
      </div>
    </>
  );
  const masterEditorMobileFurtherActions = masterEditorDeleteAction ? (
    <section className="master-editor-more-actions">
      <h3>Weitere Aktionen</h3>
      <p>{masterEditorDeleteAction.description}</p>
      <Button
        disabled={!isAdministrator}
        onClick={() =>
          requestMasterDelete(
            masterEditorDeleteAction.entityType,
            masterEditorDeleteAction.entityId,
            masterEditorDeleteAction.label,
          )
        }
        type="button"
        variant="danger"
      >
        <Trash2 aria-hidden="true" />
        Löschen
      </Button>
    </section>
  ) : null;
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
                ? eventStepCopy[eventStep].description
                : adminAreaCopy[adminArea].description
            }
            title={
              adminArea === "events"
                ? eventStepCopy[eventStep].title
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
                setTemplateDraft(null);
                setTemplateValidation(null);
                setTemplateError(null);
                setTemplateFileName("");
                setTemplateDialogOpen(true);
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
                eventFlow={eventFlow}
                eventFlowError={eventFlowError}
                eventFlowLoading={eventFlowLoading}
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
                onClick={openFactoryReset}
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
            <section
              aria-labelledby={`admin-event-step-${eventStep}-tab`}
              id={`admin-event-step-${eventStep}-panel`}
              role="tabpanel"
            >
            <MasterDataWorkspace
              event={board.event}
              filters={
                masterDataCategory === "resource-groups" ? (
                  <label className="master-data-status-filter">
                    <span>Status</span>
                    <select
                      onChange={(event) => setResourceStatusFilter(event.target.value)}
                      value={resourceStatusFilter}
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
              addAriaLabel={`${masterDataSingularLabel[masterDataCategory]} hinzufügen`}
              onNew={startNewMasterDataEntry}
              onSearchChange={setMasterSearch}
              resultCount={activeMasterDataRows.length}
              search={masterSearch}
            >
              {masterDataCategory === "gates" ? (
                <GatesWorkspace
                  board={board}
                  emptyLabel={masterDataEmptyState}
                  onDelete={(id, label) => requestMasterDelete("GATE", id, label)}
                  onEdit={selectGateForEditing}
                  onSort={toggleMasterSort}
                  rows={pagedGates}
                  sortDirection={masterSort.category === "gates" ? masterSort.direction : null}
                  sortKey={masterSort.category === "gates" ? masterSort.key : undefined}
                />
              ) : null}
              {masterDataCategory === "resource-groups" ? (
                <ResourceGroupsWorkspace
                  board={board}
                  onAssign={(resourceGroupId) =>
                    setAssignmentDialogContext({ mode: "resource-group", resourceGroupId })
                  }
                  onDelete={(id, label) => requestMasterDelete("RESOURCE_GROUP", id, label)}
                  onEdit={selectResourceForEditing}
                  rows={pagedResourceGroups}
                />
              ) : null}
              {masterDataCategory === "aircraft" ? (
                <AircraftWorkspace
                  board={board}
                  emptyLabel={masterDataEmptyState}
                  onAssign={(aircraftId) =>
                    setAssignmentDialogContext({ mode: "aircraft", aircraftId })
                  }
                  onDelete={(id, label) => requestMasterDelete("AIRCRAFT", id, label)}
                  onEdit={selectAircraftForEditing}
                  onSort={toggleMasterSort}
                  onTurnaround={(aircraftId) =>
                    setTurnaroundDialogContext({ mode: "aircraft", aircraftId })
                  }
                  rows={pagedAircraft}
                  sortDirection={masterSort.category === "aircraft" ? masterSort.direction : null}
                  sortKey={masterSort.category === "aircraft" ? masterSort.key : undefined}
                />
              ) : null}
              {masterDataCategory === "pilots" ? (
                <PilotCodesWorkspace
                  emptyLabel={masterDataEmptyState}
                  onDelete={(id, label) => requestMasterDelete("PILOT", id, label)}
                  onEdit={selectPilotForEditing}
                  onSort={toggleMasterSort}
                  rows={pagedPilots}
                  sortDirection={masterSort.category === "pilots" ? masterSort.direction : null}
                  sortKey={masterSort.category === "pilots" ? masterSort.key : undefined}
                />
              ) : null}
              {masterDataCategory === "products" ? (
                <ProductsWorkspace
                  emptyLabel={masterDataEmptyState}
                  onDelete={(id, label) => requestMasterDelete("PRODUCT", id, label)}
                  onEdit={selectProductForEditing}
                  onSales={(productId) => {
                    const product = board.products.find((entry) => entry.id === productId);
                    if (!product) return;
                    setSalesProductId(product.id);
                    setSaleClosesAt(
                      product.saleClosesAt
                        ? formatEventLocalDateTime(product.saleClosesAt, board.event.timeZone)
                        : "",
                    );
                  }}
                  onSort={toggleMasterSort}
                  onTurnaround={(productId) =>
                    setTurnaroundDialogContext({ mode: "product", productId })
                  }
                  rows={pagedProducts}
                  sortDirection={masterSort.category === "products" ? masterSort.direction : null}
                  sortKey={masterSort.category === "products" ? masterSort.key : undefined}
                />
              ) : null}
              {masterDataCategory === "resource-groups" && activeMasterDataRows.length === 0
                ? masterDataEmptyState
                : null}
              <MasterDataPagination
                count={activeMasterDataRows.length}
                onPageChange={setMasterPage}
                onPageSizeChange={setMasterPageSize}
                page={masterPageClamped}
                pageSize={masterPageSize}
              />
            </MasterDataWorkspace>
            </section>
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
            initialFocusSelector={masterEditorInitialFocusSelector}
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
            initialFocusSelector={masterEditorInitialFocusSelector}
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
            initialFocusSelector={masterEditorInitialFocusSelector}
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
            initialFocusSelector={masterEditorInitialFocusSelector}
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
                <section className="admin-section admin-simulator-launch">
                  <div className="admin-simulator-launch-copy">
                    <span aria-hidden="true" className="admin-simulator-launch-icon">
                      <FlaskConical />
                    </span>
                    <div>
                      <div className="admin-simulator-launch-title">
                        <h2>Prognose-Simulator</h2>
                        <span>Nur Simulation</span>
                      </div>
                      <p>
                        Stammdaten und offene Planeinträge als lokale Simulationsgrundlage
                        verwenden. {"Tickets, Ist-Verläufe und operative Zustände werden nicht exportiert."}
                      </p>
                    </div>
                  </div>
                  <div className="admin-simulator-launch-actions">
                    <Button
                      busy={busyActionKey === "export-simulation-plan"}
                      disabled={!board || busyActionKey !== null}
                      onClick={() =>
                        void runBusyAction("export-simulation-plan", exportSimulationPlan)
                      }
                      type="button"
                    >
                      Simulationsgrundlage exportieren
                    </Button>
                    <a
                      className="admin-simulator-launch-action"
                      href="/simulation"
                      rel="noopener"
                      target="_blank"
                    >
                      Prognose-Simulator öffnen
                      <ExternalLink aria-hidden="true" />
                    </a>
                  </div>
                </section>
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
                <CompletionSummaryPanel
                  board={board}
                  busyActionKey={busyActionKey}
                  onExportDailyCsv={() =>
                    void runBusyAction("export-daily-csv", exportDailyReport)
                  }
                  onExportDailyPdf={() =>
                    void runBusyAction("export-daily-pdf", exportDailyPdf)
                  }
                  onExportPerformance={() =>
                    void runBusyAction("export-performance", exportPerformanceProfile)
                  }
                  onExportRawData={() =>
                    void runBusyAction("export-raw-data", exportRawData)
                  }
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
                  onCorrect={(ticketGroupId, targetRotationId, correctionReason) =>
                    requestAdminAction(() =>
                      runBusyAction("manifest-correction", () =>
                        correctRotationManifest(
                          ticketGroupId,
                          targetRotationId,
                          correctionReason,
                        ),
                      ),
                    )
                  }
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
            busy={templateBusy}
            draft={templateDraft}
            error={templateError}
            fileName={templateFileName}
            onClose={() => setTemplateDialogOpen(false)}
            onFile={(file) => void readMasterDataTemplate(file)}
            onImport={() => void applyMasterDataTemplate()}
            open={templateDialogOpen}
            validation={templateValidation}
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
            busy={factoryResetBusy}
            confirmation={factoryResetConfirmation}
            deleteAllBackups={deleteAllBackups}
            error={factoryResetError}
            onClose={() => setFactoryResetOpen(false)}
            onConfirmationChange={setFactoryResetConfirmation}
            onDeleteAllBackupsChange={(checked) => {
              setDeleteAllBackups(checked);
              if (checked) setRetainRecoveryBackup(false);
            }}
            onPinChange={setFactoryResetPin}
            onReasonChange={setFactoryResetReason}
            onRetainRecoveryBackupChange={(checked) => {
              setRetainRecoveryBackup(checked);
              if (checked) setDeleteAllBackups(false);
            }}
            onSubmit={() => void performFactoryReset()}
            open={factoryResetOpen}
            pin={factoryResetPin}
            reason={factoryResetReason}
            retainRecoveryBackup={retainRecoveryBackup}
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
