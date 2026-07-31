import type {
  AdminEventFlow,
  AuditHistory,
  EventCatalogEntry,
  EventLogoTheme,
  ForecastHistory,
  MasterDataTemplate,
  MasterDataTemplateValidation,
  OperationalHistory,
  OperationBoard,
} from "@rundflug/contracts";
import { masterDataTemplateSchema } from "@rundflug/contracts";
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  FlaskConical,
  LockKeyhole,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  manifestCorrectionCandidates,
  manifestCorrectionTargets,
} from "./admin-manifest-correction";
import { createMasterEditorSnapshot, hasMasterEditorChanges } from "./admin-master-editor-state";
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
  cloneEvent,
  deleteEvent,
  downloadDailyPdf,
  downloadDailyReport,
  downloadMasterDataTemplate,
  downloadPerformanceProfile,
  downloadSimulationPlan,
  downloadTicketRawData,
  factoryReset,
  getAdminEventFlow,
  getAuditHistory,
  getEventCatalog,
  getForecastHistory,
  getOperationalHistory,
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
  CheckboxField,
  ConfirmationDialog,
  Field,
  ModalDialog,
  PageHeader,
  Panel,
  SearchField,
  StatusPill,
  Tabs,
} from "./design-system/components";
import { forgetActiveEvent, rememberActiveEvent } from "./event-context";
import { eventLocalDateTimeToIso, formatEventLocalDateTime } from "./event-time";
import { AdminEventFlowChart } from "./features/admin/AdminEventFlowChart";
import {
  AircraftProductTurnaroundOverrideDialog,
  type TurnaroundOverrideContext,
} from "./features/admin/aircraft/AircraftProductTurnaroundOverrideDialog";
import {
  type AircraftResourceGroupAssignmentContext,
  AircraftResourceGroupAssignmentDialog,
} from "./features/admin/aircraft/AircraftResourceGroupAssignmentDialog";
import { AircraftWorkspace } from "./features/admin/aircraft/AircraftWorkspace";
import { CompletionWorkspace } from "./features/admin/completion/CompletionWorkspace";
import {
  type EventParameterSaveLifecycle,
  EventParametersWorkspace,
} from "./features/admin/event-parameters/EventParametersWorkspace";
import type { ValidEventParameterPayload } from "./features/admin/event-parameters/useEventParametersForm";
import { FactoryResetDialog } from "./features/admin/FactoryResetDialog";
import { GatesWorkspace } from "./features/admin/gates/GatesWorkspace";
import { MasterDataPagination } from "./features/admin/master-data/MasterDataPagination";
import {
  MasterDataEmptyState,
  MasterDataWorkspace,
} from "./features/admin/master-data/MasterDataWorkspace";
import { OperationsWorkspace } from "./features/admin/operations/OperationsWorkspace";
import { ProductSalesClosingDialog } from "./features/admin/operations/ProductSalesClosingDialog";
import { PilotCodesWorkspace } from "./features/admin/pilots/PilotCodesWorkspace";
import { ProductsWorkspace } from "./features/admin/products/ProductsWorkspace";
import { ResourceGroupsWorkspace } from "./features/admin/resource-groups/ResourceGroupsWorkspace";
import { AccountManagement } from "./features/auth/AccountManagement";
import { useAuth } from "./features/auth/AuthContext";
import {
  OperationalPlanPanel,
  type PlannedOperation,
  type RecurringOperationalRule,
  type UpsertPlannedOperationPayload,
  type UpsertRecurringOperationalRulePayload,
} from "./features/operations/OperationalPlanPanel";
import {
  formatGermanDate,
  LocalizedDateInput,
  LocalizedDateTimeInput,
} from "./localized-date-input";
import { clearOfflineOperationBoards } from "./offline-store";
import {
  ADMIN_CONFIGURATION_AUDIT_REASON,
  ADMIN_DEVICE_ID,
  aircraftStateLabel,
  ConnectionNotice,
  capacityLabel,
  deviceTokenFor,
  EmergencyNotice,
  EVENT_ID,
  FieldGroupLabel,
  FieldHelp,
  FieldLabel,
  type GateDisplayStatus,
  InterruptionNotice,
  MASTER_DATA_AUDIT_REASON,
  MASTER_DATA_DELETE_REASON,
  type MasterDataDeleteTarget,
  OPERATIONAL_AUDIT_REASON,
  OperationalNotice,
  predictionQualityLabel,
  rotationStatusLabel,
  useOperationBoard,
} from "./operation-workspace";
import { formatEuroInput, parseEuroToCents } from "./product-editor";
import { ProductReferenceRotation } from "./product-reference-rotation";

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
  operations: {
    title: "Betrieb",
    description: "Betriebsplan, Freigabe, Kapazität und organisatorische Eingriffe verwalten.",
  },
  completion: {
    title: "Abschluss",
    description: "Betriebstag prüfen, Berichte exportieren und Verläufe auswerten.",
  },
};

const historyTicketStatusLabels: Record<string, string> = {
  QUEUED: "In Warteschlange",
  CHECKED_IN: "Eingecheckt",
  CALLED: "Aufgerufen",
  BOARDING: "Boarding",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
  NO_SHOW: "Nicht erschienen",
  CANCELED: "Storniert",
  CLARIFICATION: "Klärung erforderlich",
};

const historyEventLabels: Record<string, string> = {
  TICKET_NO_SHOW: "Ticket als nicht erschienen markiert",
  ROTATION_CALLED: "Fluggruppe aufgerufen",
  ROTATION_DEPARTED: "Umlauf gestartet",
  ROTATION_LANDED: "Umlauf gelandet",
  ROTATION_COMPLETED: "Umlauf abgeschlossen",
  AIRCRAFT_RESOURCE_GROUP_ASSIGNED: "Flugzeug einer Ressourcengruppe zugeordnet",
  PRODUCT_SALES_CONFIGURED: "Verkaufssteuerung geändert",
  EMERGENCY_TRIGGERED: "Notfallmodus aktiviert",
  EMERGENCY_CLEARED: "Notfallmodus aufgehoben",
};

export function AdminView() {
  const { session, logout } = useAuth();
  const { board, error, lastConfirmedAt, backendConfirmed, refresh, refreshing } =
    useOperationBoard(ADMIN_DEVICE_ID);
  const initialAdminParams = useRef(new URLSearchParams(window.location.search)).current;
  const [adminArea, setAdminArea] = useState<AdminArea>(() => {
    const requestedArea = initialAdminParams.get("area");
    const validAreas: AdminArea[] = ["overview", "events", "users", "evaluation", "backup"];
    if (["setup", "master-data", "audit"].includes(requestedArea ?? "")) return "events";
    return (validAreas as string[]).includes(requestedArea ?? "")
      ? (requestedArea as AdminArea)
      : "overview";
  });
  const [accountCreateOpen, setAccountCreateOpen] = useState(false);
  const [eventStep, setEventStep] = useState<AdminEventStep>(() => {
    const requestedArea = initialAdminParams.get("area");
    const requestedStep = initialAdminParams.get("step");
    const legacySection = initialAdminParams.get("section");
    const validSteps: AdminEventStep[] = [
      "event",
      "gates",
      "resource-groups",
      "aircraft",
      "pilots",
      "products",
      "operations",
      "completion",
    ];
    if ((validSteps as string[]).includes(requestedStep ?? "")) {
      return requestedStep as AdminEventStep;
    }
    if (requestedArea === "audit") return "completion";
    if (requestedArea === "master-data") {
      if (legacySection === "assignments") return "aircraft";
      if ((validSteps as string[]).includes(legacySection ?? "")) {
        return legacySection as AdminEventStep;
      }
      return "resource-groups";
    }
    return "event";
  });
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
  const legacyAssignmentRequestRef = useRef({
    requested:
      initialAdminParams.get("area") === "master-data" &&
      initialAdminParams.get("section") === "assignments",
    aircraftId: initialAdminParams.get("aircraftId") ?? "",
    handled: false,
  });
  const adminWorkspaceScrollRef = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("area", adminArea);
    if (adminArea === "events") url.searchParams.set("step", eventStep);
    else url.searchParams.delete("step");
    url.searchParams.delete("section");
    window.history.replaceState(null, "", url);
  }, [adminArea, eventStep]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: switching area or setup step intentionally resets the independent content scroller
  useEffect(() => {
    adminWorkspaceScrollRef.current?.scrollTo({ top: 0 });
  }, [adminArea, eventStep]);
  const [reason, setReason] = useState("");
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
  const [salesClosingProductId, setSalesClosingProductId] = useState<string | null>(null);
  const [endOperationsConfirmOpen, setEndOperationsConfirmOpen] = useState(false);
  const [pendingEmergencyAction, setPendingEmergencyAction] = useState<
    "TRIGGER_EMERGENCY" | "CLEAR_EMERGENCY" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  useActionMessageBridge(message, setMessage);
  const [setupRequired, setSetupRequired] = useState(false);
  const [history, setHistory] = useState<AuditHistory>({ entries: [] });
  const [historyView, setHistoryView] = useState<"OPERATIONS" | "FORECASTS" | "AUDIT">(
    "OPERATIONS",
  );
  const [operationalHistory, setOperationalHistory] = useState<OperationalHistory>({
    entries: [],
    total: 0,
    limit: 50,
    offset: 0,
  });
  const [forecastHistory, setForecastHistory] = useState<ForecastHistory>({
    entries: [],
    total: 0,
    limit: 50,
    offset: 0,
  });
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyEventType, setHistoryEventType] = useState("");
  const [historyAggregateType, setHistoryAggregateType] = useState("");
  const [historyAggregateId, setHistoryAggregateId] = useState("");
  const [historySince, setHistorySince] = useState("");
  const [historyUntil, setHistoryUntil] = useState("");
  const [historyTicketStatus, setHistoryTicketStatus] = useState("");
  const [historyAircraftId, setHistoryAircraftId] = useState("");
  const [historyPilotId, setHistoryPilotId] = useState("");
  const [historyProductId, setHistoryProductId] = useState("");
  const [historyResourceGroupId, setHistoryResourceGroupId] = useState("");
  const [historyCommunicationNumber, setHistoryCommunicationNumber] = useState("");
  const [historyTicketId, setHistoryTicketId] = useState("");
  const [historyTicketGroupId, setHistoryTicketGroupId] = useState("");
  const [historyRotationId, setHistoryRotationId] = useState("");
  const [historyTextSearch, setHistoryTextSearch] = useState("");
  const historyFiltersByViewRef = useRef({
    OPERATIONS: null as Record<string, string> | null,
    FORECASTS: null as Record<string, string> | null,
    AUDIT: null as Record<string, string> | null,
  });
  const [pilotCode, setPilotCode] = useState("P-01");
  const [pilotNote, setPilotNote] = useState("");
  const [pilotEditorId, setPilotEditorId] = useState("new");
  const [eventParametersDirty, setEventParametersDirty] = useState(false);
  const [eventParametersResetKey, setEventParametersResetKey] = useState(0);
  const [discardEventNavigationOpen, setDiscardEventNavigationOpen] = useState(false);
  const pendingEventNavigationRef = useRef<(() => void) | null>(null);
  const [pushConfigurationStatus, setPushConfigurationStatus] = useState<
    "loading" | "configured" | "missing" | "unavailable"
  >("loading");
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
  useEffect(() => {
    if (!eventParametersDirty) return;
    const warnBeforeUnload = (unloadEvent: BeforeUnloadEvent) => {
      unloadEvent.preventDefault();
      unloadEvent.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [eventParametersDirty]);
  const [productEditorId, setProductEditorId] = useState("new");
  const [productName, setProductName] = useState("");
  const [productCode, setProductCode] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productResourceGroupId, setProductResourceGroupId] = useState("");
  const [productGateId, setProductGateId] = useState("");
  const [productPriceInput, setProductPriceInput] = useState("0,00 €");
  const [productReferenceDuration, setProductReferenceDuration] = useState(20);
  const [productPromisedFlightMinutes, setProductPromisedFlightMinutes] = useState(20);
  const [productBoardingOverride, setProductBoardingOverride] = useState("");
  const [productDeboardingOverride, setProductDeboardingOverride] = useState("");
  const [productBufferOverride, setProductBufferOverride] = useState("");
  const [productChildCompanion, setProductChildCompanion] = useState(false);
  const [productWeightClasses, setProductWeightClasses] = useState<string[]>(["NOT_CAPTURED"]);
  const [gateEditorId, setGateEditorId] = useState("new");
  const [gateLabel, setGateLabel] = useState("");
  const [gateType, setGateType] = useState<"FLIGHT_LINE" | "BOARDING" | "DISPLAY_ONLY">(
    "FLIGHT_LINE",
  );
  const [gateActive, setGateActive] = useState(true);
  const [gateSortOrder, setGateSortOrder] = useState(10);
  const [gateDisplayProductIds, setGateDisplayProductIds] = useState<string[]>([]);
  const [gateDisplayRotationStatuses, setGateDisplayRotationStatuses] = useState<
    GateDisplayStatus[]
  >([]);
  const [manifestTicketGroupId, setManifestTicketGroupId] = useState("");
  const [manifestTargetRotationId, setManifestTargetRotationId] = useState("");
  const [manifestCorrectionReason, setManifestCorrectionReason] = useState("");
  const [resourceEditorId, setResourceEditorId] = useState("new");
  const [resourceName, setResourceName] = useState("");
  const [resourceShortCode, setResourceShortCode] = useState("");
  const [resourceGateId, setResourceGateId] = useState("");
  const [resourceAutomaticPrecall, setResourceAutomaticPrecall] = useState(true);
  const [aircraftEditorId, setAircraftEditorId] = useState("new");
  const [aircraftRegistration, setAircraftRegistration] = useState("");
  const [aircraftType, setAircraftType] = useState("");
  const [aircraftSeats, setAircraftSeats] = useState(3);
  const [aircraftMaximumPayload, setAircraftMaximumPayload] = useState("");
  const currentMasterEditorSnapshot =
    masterDataCategory === "gates"
      ? createMasterEditorSnapshot([
          "gates",
          gateLabel,
          gateType,
          gateActive,
          gateSortOrder,
          gateDisplayProductIds,
          gateDisplayRotationStatuses,
        ])
      : masterDataCategory === "products"
        ? createMasterEditorSnapshot([
            "products",
            productName,
            productCode,
            productDescription,
            productResourceGroupId,
            productGateId,
            productPriceInput,
            productReferenceDuration,
            productPromisedFlightMinutes,
            productBoardingOverride,
            productDeboardingOverride,
            productBufferOverride,
            productChildCompanion,
            productWeightClasses,
          ])
        : masterDataCategory === "resource-groups"
          ? createMasterEditorSnapshot([
              "resource-groups",
              resourceName,
              resourceShortCode,
              resourceGateId,
              resourceAutomaticPrecall,
            ])
          : masterDataCategory === "aircraft"
            ? createMasterEditorSnapshot([
                "aircraft",
                aircraftRegistration,
                aircraftType,
                aircraftSeats,
                aircraftMaximumPayload,
              ])
            : createMasterEditorSnapshot(["pilots", pilotCode, pilotNote]);
  const masterEditorDirty =
    masterEditorOpen &&
    hasMasterEditorChanges(initialMasterEditorSnapshotRef.current, currentMasterEditorSnapshot);
  const [events, setEvents] = useState<EventCatalogEntry[]>([]);
  const [eventFlow, setEventFlow] = useState<AdminEventFlow | null>(null);
  const [eventFlowError, setEventFlowError] = useState<string | null>(null);
  const [eventFlowLoading, setEventFlowLoading] = useState(true);
  const [eventDialogView, setEventDialogView] = useState<"closed" | "catalog" | "create">("closed");
  const [eventSearch, setEventSearch] = useState("");
  const [eventSort, setEventSort] = useState<{
    key: "name" | "eventDate" | "status" | "aerodrome";
    direction: "asc" | "desc" | null;
  }>({ key: "eventDate", direction: null });
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateFileName, setTemplateFileName] = useState("");
  const [templateDraft, setTemplateDraft] = useState<MasterDataTemplate | null>(null);
  const [templateValidation, setTemplateValidation] = useState<MasterDataTemplateValidation | null>(
    null,
  );
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [newEventId, setNewEventId] = useState("");
  const [newEventName, setNewEventName] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventAerodrome, setNewEventAerodrome] = useState("");
  const [restartMode, setRestartMode] = useState<"KEEP_MASTER_DATA" | "EMPTY">("KEEP_MASTER_DATA");
  const [restartConfirmation, setRestartConfirmation] = useState("");
  const [eventCreationError, setEventCreationError] = useState<string | null>(null);
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
  const productPriceCents = parseEuroToCents(productPriceInput);
  const manifestCandidates = manifestCorrectionCandidates(board?.rotations ?? []);
  const selectedManifestCandidate = manifestCandidates.find(
    (candidate) => candidate.ticketGroupId === manifestTicketGroupId,
  );
  const manifestTargets = manifestCorrectionTargets(
    board?.rotations ?? [],
    selectedManifestCandidate,
  );
  const eventVersion = board?.event.version;
  const eventCreationDisabled =
    !isAdministrator ||
    restartConfirmation !== "NEUSTART" ||
    !/^[a-z0-9-]{3,64}$/.test(newEventId.trim()) ||
    newEventName.trim().length < 3 ||
    !newEventDate ||
    newEventAerodrome.trim().length < 2;

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
    const entry = board.resourceGroups[0];
    setResourceEditorId(entry?.id ?? "new");
    setResourceName(entry?.name ?? "");
    setResourceShortCode(entry?.shortCode ?? "");
    setResourceGateId(entry?.gateId ?? board.gates.find((gate) => gate.active)?.id ?? "");
    setResourceAutomaticPrecall(entry?.automaticPrecallEnabled ?? true);
  }, [adminArea, board, eventStep]);

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
  const refreshHistory = useCallback(async () => {
    try {
      const timeZone = board?.event.timeZone ?? "Europe/Berlin";
      setHistory(
        await getAuditHistory(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID), {
          eventType: historyEventType,
          aggregateType: historyAggregateType,
          aggregateId: historyAggregateId,
          ...(historySince ? { since: eventLocalDateTimeToIso(historySince, timeZone) } : {}),
          ...(historyUntil ? { until: eventLocalDateTimeToIso(historyUntil, timeZone) } : {}),
        }),
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Historie nicht verfügbar.");
    }
  }, [
    board?.event.timeZone,
    historyAggregateId,
    historyAggregateType,
    historyEventType,
    historySince,
    historyUntil,
  ]);
  const refreshDetailedHistory = useCallback(
    async (requestedOffset: number) => {
      try {
        const timeZone = board?.event.timeZone ?? "Europe/Berlin";
        const shared = {
          ...(historySince ? { since: eventLocalDateTimeToIso(historySince, timeZone) } : {}),
          ...(historyUntil ? { until: eventLocalDateTimeToIso(historyUntil, timeZone) } : {}),
          ...(historyAircraftId ? { aircraftId: historyAircraftId } : {}),
          ...(historyPilotId ? { pilotId: historyPilotId } : {}),
          ...(historyRotationId ? { rotationId: historyRotationId.trim() } : {}),
          limit: 50,
          offset: requestedOffset,
        };
        if (historyView === "FORECASTS") {
          setForecastHistory(
            await getForecastHistory(
              EVENT_ID,
              ADMIN_DEVICE_ID,
              deviceTokenFor(ADMIN_DEVICE_ID),
              shared,
            ),
          );
        } else if (historyView === "OPERATIONS") {
          setOperationalHistory(
            await getOperationalHistory(
              EVENT_ID,
              ADMIN_DEVICE_ID,
              deviceTokenFor(ADMIN_DEVICE_ID),
              {
                ...shared,
                ...(historyTicketStatus
                  ? {
                      ticketStatus:
                        historyTicketStatus as OperationalHistory["entries"][number]["ticketStatus"],
                    }
                  : {}),
                ...(historyProductId ? { productId: historyProductId } : {}),
                ...(historyResourceGroupId ? { resourceGroupId: historyResourceGroupId } : {}),
                ...(historyCommunicationNumber
                  ? { communicationNumber: Number(historyCommunicationNumber) }
                  : {}),
                ...(historyTicketId ? { ticketId: historyTicketId.trim() } : {}),
                ...(historyTicketGroupId ? { ticketGroupId: historyTicketGroupId.trim() } : {}),
              },
            ),
          );
        }
        setHistoryOffset(requestedOffset);
      } catch (cause) {
        setMessage(cause instanceof Error ? cause.message : "Verlauf nicht verfügbar.");
      }
    },
    [
      board?.event.timeZone,
      historyAircraftId,
      historyCommunicationNumber,
      historyPilotId,
      historyProductId,
      historyResourceGroupId,
      historyRotationId,
      historySince,
      historyTicketGroupId,
      historyTicketId,
      historyTicketStatus,
      historyUntil,
      historyView,
    ],
  );
  useEffect(() => {
    void refreshHistory();
    if (historyView !== "AUDIT") void refreshDetailedHistory(0);
  }, [historyView, refreshDetailedHistory, refreshHistory]);
  useEffect(() => {
    if (adminArea === "events" && eventStep === "completion" && historyView === "AUDIT") return;
    if (adminArea !== "events" && historyView === "AUDIT") setHistoryView("OPERATIONS");
  }, [adminArea, eventStep, historyView]);

  function changeHistoryView(nextView: "OPERATIONS" | "FORECASTS" | "AUDIT") {
    historyFiltersByViewRef.current[historyView] = {
      since: historySince,
      until: historyUntil,
      eventType: historyEventType,
      aggregateType: historyAggregateType,
      aggregateId: historyAggregateId,
      ticketStatus: historyTicketStatus,
      aircraftId: historyAircraftId,
      pilotId: historyPilotId,
      productId: historyProductId,
      resourceGroupId: historyResourceGroupId,
      communicationNumber: historyCommunicationNumber,
      ticketId: historyTicketId,
      ticketGroupId: historyTicketGroupId,
      rotationId: historyRotationId,
      textSearch: historyTextSearch,
    };
    const next = historyFiltersByViewRef.current[nextView] ?? {};
    setHistorySince(next.since ?? "");
    setHistoryUntil(next.until ?? "");
    setHistoryEventType(next.eventType ?? "");
    setHistoryAggregateType(next.aggregateType ?? "");
    setHistoryAggregateId(next.aggregateId ?? "");
    setHistoryTicketStatus(next.ticketStatus ?? "");
    setHistoryAircraftId(next.aircraftId ?? "");
    setHistoryPilotId(next.pilotId ?? "");
    setHistoryProductId(next.productId ?? "");
    setHistoryResourceGroupId(next.resourceGroupId ?? "");
    setHistoryCommunicationNumber(next.communicationNumber ?? "");
    setHistoryTicketId(next.ticketId ?? "");
    setHistoryTicketGroupId(next.ticketGroupId ?? "");
    setHistoryRotationId(next.rotationId ?? "");
    setHistoryTextSearch(next.textSearch ?? "");
    setHistoryOffset(0);
    setHistoryView(nextView);
  }

  function resetHistoryFilters() {
    setHistorySince("");
    setHistoryUntil("");
    setHistoryEventType("");
    setHistoryAggregateType("");
    setHistoryAggregateId("");
    setHistoryTicketStatus("");
    setHistoryAircraftId("");
    setHistoryPilotId("");
    setHistoryProductId("");
    setHistoryResourceGroupId("");
    setHistoryCommunicationNumber("");
    setHistoryTicketId("");
    setHistoryTicketGroupId("");
    setHistoryRotationId("");
    setHistoryTextSearch("");
    setHistoryOffset(0);
  }
  const refreshEvents = useCallback(async () => {
    if (!isAdministrator) return;
    try {
      setEvents(
        (await getEventCatalog(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID))).events,
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Veranstaltungen nicht verfügbar.");
    }
  }, [isAdministrator]);
  useEffect(() => {
    void refreshEvents();
  }, [refreshEvents]);

  async function exportMasterDataTemplate() {
    await downloadMasterDataTemplate(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID));
    setMessage("Stammdatenvorlage wurde als versionierte JSON-Datei exportiert.");
  }

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
      await Promise.all([refresh(), refreshEvents(), refreshHistory()]);
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

  async function createEventFromTemplate() {
    setEventCreationError(null);
    try {
      const adminToken = deviceTokenFor(ADMIN_DEVICE_ID);
      const result = await cloneEvent(EVENT_ID, ADMIN_DEVICE_ID, adminToken, {
        commandId: crypto.randomUUID(),
        expectedSourceVersion: board?.event.version ?? 0,
        eventId: newEventId,
        name: newEventName,
        eventDate: newEventDate,
        aerodrome: newEventAerodrome,
        timeZone: board?.event.timeZone ?? "Europe/Berlin",
        restartMode,
      });
      rememberActiveEvent(window.localStorage, result.eventId);
      window.location.assign(`/admin?event=${encodeURIComponent(result.eventId)}`);
    } catch (cause) {
      setEventCreationError(
        cause instanceof Error ? cause.message : "Veranstaltung konnte nicht angelegt werden.",
      );
    }
  }

  async function removeEvent(eventId: string, eventName: string, expectedVersion: number) {
    const confirmation = window.prompt(
      `„${eventName}“ wird vollständig gelöscht. Zum Bestätigen exakt „${eventId}“ eingeben:`,
    );
    if (confirmation !== eventId) return;
    const reason = window.prompt("Kurze Begründung für die Löschung:")?.trim() ?? "";
    if (reason.length < 3) {
      setMessage("Die Löschung benötigt eine Begründung mit mindestens drei Zeichen.");
      return;
    }
    try {
      const result = await deleteEvent(
        EVENT_ID,
        eventId,
        expectedVersion,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        reason,
      );
      if (eventId === EVENT_ID) {
        forgetActiveEvent(window.localStorage);
        window.location.assign(result.setupRequired ? "/setup" : "/");
        return;
      }
      setMessage(
        result.assetCleanupPending
          ? "Veranstaltung gelöscht; die Logo-Bereinigung wird erneut versucht."
          : "Veranstaltung vollständig gelöscht.",
      );
      await refreshEvents();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Veranstaltung konnte nicht gelöscht werden.",
      );
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
      await refreshEvents();
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
    const entry = board?.products.find((product) => product.id === id);
    const nextName = entry?.name ?? "";
    const nextCode = entry?.code ?? "";
    const nextDescription = entry?.publicDescription ?? "";
    const nextResourceGroupId = entry?.resourceGroupId ?? resourceGroups[0]?.id ?? "";
    const nextGateId = entry?.gateId ?? board?.gates.find((gate) => gate.active)?.id ?? "";
    const nextPriceInput = formatEuroInput(entry?.priceCents ?? 0);
    const nextReferenceDuration = entry?.referenceDurationMinutes ?? 20;
    const nextPromisedFlightMinutes = entry?.promisedFlightMinutes ?? 20;
    const nextBoardingOverride = entry?.plannedBoardingMinutesOverride?.toString() ?? "";
    const nextDeboardingOverride = entry?.plannedDeboardingMinutesOverride?.toString() ?? "";
    const nextBufferOverride = entry?.plannedBufferMinutesOverride?.toString() ?? "";
    const nextChildCompanion = entry?.childCompanionRequired ?? false;
    const nextWeightClasses = entry?.weightClasses ?? ["NOT_CAPTURED"];
    initialMasterEditorSnapshotRef.current = createMasterEditorSnapshot([
      "products",
      nextName,
      nextCode,
      nextDescription,
      nextResourceGroupId,
      nextGateId,
      nextPriceInput,
      nextReferenceDuration,
      nextPromisedFlightMinutes,
      nextBoardingOverride,
      nextDeboardingOverride,
      nextBufferOverride,
      nextChildCompanion,
      nextWeightClasses,
    ]);
    setProductEditorId(id);
    setProductName(nextName);
    setProductCode(nextCode);
    setProductDescription(nextDescription);
    setProductResourceGroupId(nextResourceGroupId);
    setProductGateId(nextGateId);
    setProductPriceInput(nextPriceInput);
    setProductReferenceDuration(nextReferenceDuration);
    setProductPromisedFlightMinutes(nextPromisedFlightMinutes);
    setProductBoardingOverride(nextBoardingOverride);
    setProductDeboardingOverride(nextDeboardingOverride);
    setProductBufferOverride(nextBufferOverride);
    setProductChildCompanion(nextChildCompanion);
    setProductWeightClasses(nextWeightClasses);
    setMasterSubmitAttempted(false);
    setMasterEditorTab("general");
    setMasterEditorOpen(true);
  }

  function selectGateForEditing(id: string) {
    const entry = board?.gates.find((gate) => gate.id === id);
    const nextLabel = entry?.label ?? "";
    const nextType = entry?.gateType ?? "FLIGHT_LINE";
    const nextActive = entry?.active ?? true;
    const nextSortOrder = entry?.sortOrder ?? 10;
    const nextProductIds = entry?.displayFilter.productIds ?? [];
    const nextRotationStatuses = entry?.displayFilter.rotationStatuses ?? [];
    initialMasterEditorSnapshotRef.current = createMasterEditorSnapshot([
      "gates",
      nextLabel,
      nextType,
      nextActive,
      nextSortOrder,
      nextProductIds,
      nextRotationStatuses,
    ]);
    setGateEditorId(id);
    setGateLabel(nextLabel);
    setGateType(nextType);
    setGateActive(nextActive);
    setGateSortOrder(nextSortOrder);
    setGateDisplayProductIds(nextProductIds);
    setGateDisplayRotationStatuses(nextRotationStatuses);
    setMasterSubmitAttempted(false);
    setMasterEditorTab("general");
    setMasterEditorOpen(true);
  }

  async function saveGate() {
    if (!board || gateLabel.trim().length < 2 || adminPinRef.current.length < 4) return;
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
            gateId: gateEditorId === "new" ? crypto.randomUUID() : gateEditorId,
            label: gateLabel.trim(),
            gateType,
            active: gateActive,
            sortOrder: gateSortOrder,
            displayFilter: {
              productIds: gateDisplayProductIds,
              rotationStatuses: gateDisplayRotationStatuses,
            },
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Gate-Stammdaten wurden protokolliert gespeichert.");
      if (!adminModeUnlocked) setAdminPin("");
      finishMasterEditor();
      setGateEditorId("new");
      setGateLabel("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Gate konnte nicht gespeichert werden.");
    }
  }

  async function correctRotationManifest() {
    if (
      !board ||
      !manifestTicketGroupId ||
      !manifestTargetRotationId ||
      manifestCorrectionReason.trim().length < 10 ||
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
            ticketGroupId: manifestTicketGroupId,
            targetRotationId: manifestTargetRotationId,
            reason: manifestCorrectionReason.trim(),
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setManifestTicketGroupId("");
      setManifestTargetRotationId("");
      setManifestCorrectionReason("");
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
      !productResourceGroupId ||
      !productGateId ||
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
            productId: productEditorId === "new" ? crypto.randomUUID() : productEditorId,
            resourceGroupId: productResourceGroupId,
            gateId: productGateId,
            name: productName.trim(),
            code: productCode.trim().toUpperCase(),
            publicDescription: productDescription.trim(),
            priceCents: productPriceCents,
            referenceCapacity:
              resourceGroups.find((group) => group.id === productResourceGroupId)
                ?.referenceCapacity ?? 1,
            referenceDurationMinutes: productReferenceDuration,
            promisedFlightMinutes: productPromisedFlightMinutes,
            plannedBoardingMinutesOverride:
              productBoardingOverride === "" ? null : Number(productBoardingOverride),
            plannedDeboardingMinutesOverride:
              productDeboardingOverride === "" ? null : Number(productDeboardingOverride),
            plannedBufferMinutesOverride:
              productBufferOverride === "" ? null : Number(productBufferOverride),
            childCompanionRequired: productChildCompanion,
            weightClasses: productWeightClasses as Array<
              "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL"
            >,
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
    const entry = resourceGroups.find((group) => group.id === id);
    const nextName = entry?.name ?? "";
    const nextShortCode = entry?.shortCode ?? "";
    const nextGateId = entry?.gateId ?? board?.gates.find((gate) => gate.active)?.id ?? "";
    const nextAutomaticPrecall = entry?.automaticPrecallEnabled ?? true;
    initialMasterEditorSnapshotRef.current = createMasterEditorSnapshot([
      "resource-groups",
      nextName,
      nextShortCode,
      nextGateId,
      nextAutomaticPrecall,
    ]);
    setResourceEditorId(id);
    setResourceName(nextName);
    setResourceShortCode(nextShortCode);
    setResourceGateId(nextGateId);
    setResourceAutomaticPrecall(nextAutomaticPrecall);
    setMasterSubmitAttempted(false);
    setMasterEditorOpen(true);
  }

  function selectAircraftForEditing(id: string) {
    const entry = board?.aircraft.find((aircraft) => aircraft.id === id);
    const nextRegistration = entry?.registration ?? "";
    const nextType = entry?.aircraftType ?? "";
    const nextSeats = entry?.passengerSeats ?? 3;
    const nextMaximumPayload = entry?.maximumPassengerPayloadKg?.toString() ?? "";
    initialMasterEditorSnapshotRef.current = createMasterEditorSnapshot([
      "aircraft",
      nextRegistration,
      nextType,
      nextSeats,
      nextMaximumPayload,
    ]);
    setAircraftEditorId(id);
    setAircraftRegistration(nextRegistration);
    setAircraftType(nextType);
    setAircraftSeats(nextSeats);
    setAircraftMaximumPayload(nextMaximumPayload);
    setMasterSubmitAttempted(false);
    setMasterEditorOpen(true);
  }

  async function saveResourceGroup() {
    if (
      !board ||
      !resourceGateId ||
      resourceName.trim().length < 2 ||
      !/^[A-Z0-9-]{2,8}$/.test(resourceShortCode.trim().toUpperCase()) ||
      adminPinRef.current.length < 4
    )
      return;
    try {
      const resourceGroupId = resourceEditorId === "new" ? crypto.randomUUID() : resourceEditorId;
      const currentGroup = board.resourceGroups.find((group) => group.id === resourceGroupId);
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
            name: resourceName.trim(),
            shortCode: resourceShortCode.trim().toUpperCase(),
            gateId: resourceGateId,
            referenceCapacity: currentGroup?.referenceCapacity ?? 1,
            compatibleAircraftTypes: [],
            automaticPrecallEnabled: resourceAutomaticPrecall,
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
      aircraftRegistration.trim().length < 3 ||
      aircraftType.trim().length < 2 ||
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
            aircraftId: aircraftEditorId === "new" ? crypto.randomUUID() : aircraftEditorId,
            registration: aircraftRegistration.trim().toUpperCase(),
            aircraftType: aircraftType.trim(),
            passengerSeats: aircraftSeats,
            maximumPassengerPayloadKg: aircraftMaximumPayload
              ? Number(aircraftMaximumPayload)
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

  async function emergency(type: "TRIGGER_EMERGENCY" | "CLEAR_EMERGENCY") {
    if (
      !board ||
      reason.trim().length < 3 ||
      (type === "CLEAR_EMERGENCY" && adminPinRef.current.length < 4)
    )
      return;
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
              payload: { reason: reason.trim() },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type,
              payload: { reason: reason.trim(), adminPin: adminPinRef.current },
            },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(
        type === "TRIGGER_EMERGENCY" ? "Notfallmodus ausgelöst." : "Notfallmodus aufgehoben.",
      );
      setReason("");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Notfallkommando fehlgeschlagen.");
    }
  }

  async function upsertAdminPlannedOperation(payload: UpsertPlannedOperationPayload) {
    if (!board || !isAdministrator || !adminModeUnlocked) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_PLANNED_OPERATION",
          payload,
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Planeintrag gespeichert; der operative Zustand bleibt unverändert.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Planeintrag konnte nicht gespeichert werden.",
      );
      throw cause;
    }
  }

  async function cancelAdminPlannedOperation(plan: PlannedOperation) {
    if (!board || !isAdministrator || !adminModeUnlocked) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CANCEL_PLANNED_OPERATION",
          payload: {
            planId: plan.id,
            planExpectedVersion: plan.version,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Planeintrag abgesagt; laufende Zustände wurden nicht verändert.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Planeintrag konnte nicht abgesagt werden.",
      );
      throw cause;
    }
  }

  async function upsertAdminRecurringRule(payload: UpsertRecurringOperationalRulePayload) {
    if (!board || !isAdministrator || !adminModeUnlocked) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "UPSERT_RECURRING_OPERATIONAL_RULE",
          payload,
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Wiederkehrende Regel gespeichert.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Regel konnte nicht gespeichert werden.");
      throw cause;
    }
  }

  async function disableAdminRecurringRule(rule: RecurringOperationalRule) {
    if (!board || !isAdministrator || !adminModeUnlocked) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "DISABLE_RECURRING_OPERATIONAL_RULE",
          payload: {
            ruleId: rule.id,
            ruleExpectedVersion: rule.version,
            reason: "Wiederkehrende Tagesregel deaktiviert.",
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Wiederkehrende Regel deaktiviert; offene Planeinträge bleiben bestehen.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Regel konnte nicht deaktiviert werden.");
      throw cause;
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
      setSalesClosingProductId(null);
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
      setPilotEditorId("new");
      setPilotCode("P-01");
      setPilotNote("");
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
    const entry = board?.pilots.find((pilot) => pilot.id === id);
    const nextCode = entry?.operationalCode ?? "P-01";
    const nextNote = entry?.operationalNote ?? "";
    initialMasterEditorSnapshotRef.current = createMasterEditorSnapshot([
      "pilots",
      nextCode,
      nextNote,
    ]);
    setPilotEditorId(id);
    setPilotCode(nextCode);
    setPilotNote(nextNote);
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
          const existing = board?.pilots.find((pilot) => pilot.id === pilotEditorId);
          await upsertPilot(
            pilotEditorId === "new" ? crypto.randomUUID() : pilotEditorId,
            pilotCode,
            pilotNote,
            existing?.active ?? true,
          );
        }
        if (action === "pilot-toggle") {
          const existing = board?.pilots.find((pilot) => pilot.id === pilotEditorId);
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
      productName.trim().length < 2
        ? "product-name"
        : !/^[A-Z0-9-]{2,12}$/.test(productCode)
          ? "product-code"
          : productPriceCents === null
            ? "product-price"
            : !productResourceGroupId
              ? "product-resource-group"
              : !productGateId
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
      requestMasterSave("gate", gateLabel.trim().length >= 2, "gate-label");
      return;
    }
    if (masterDataCategory === "products") {
      requestProductSave();
      return;
    }
    if (masterDataCategory === "resource-groups") {
      const invalidFieldId =
        resourceName.trim().length < 2
          ? "resource-name"
          : !/^[A-Z0-9-]{2,8}$/.test(resourceShortCode.trim().toUpperCase())
            ? "resource-short-code"
            : !resourceGateId
              ? "resource-gate"
              : undefined;
      requestMasterSave("resource-group", !invalidFieldId, invalidFieldId);
      return;
    }
    if (masterDataCategory === "aircraft") {
      const invalidFieldId =
        aircraftRegistration.trim().length < 3
          ? "aircraft-registration"
          : aircraftType.trim().length < 2
            ? "aircraft-type"
            : undefined;
      requestMasterSave("aircraft", !invalidFieldId, invalidFieldId);
      return;
    }
    requestMasterSave("pilot", /^[A-Z0-9-]{2,12}$/.test(pilotCode), "pilot-operational-code");
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
  const eventIsReleased = Boolean(board && board.event.status !== "PREPARATION");
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

  function requestEventParameterNavigation(action: () => void) {
    if (!eventParametersDirty) {
      action();
      return;
    }
    pendingEventNavigationRef.current = action;
    setDiscardEventNavigationOpen(true);
  }

  function changeAdminArea(nextArea: AdminArea) {
    if (nextArea === adminArea) return;
    requestEventParameterNavigation(() => setAdminArea(nextArea));
  }

  function openSetupStep(step: SetupStep) {
    if (adminArea === "events" && eventStep === step.id) return;
    requestEventParameterNavigation(() => {
      setAdminArea("events");
      setEventStep(step.id);
      if (step.category) setMasterDataCategory(step.category);
    });
  }

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
  const masterDataStepActive =
    adminArea === "events" &&
    ["gates", "resource-groups", "aircraft", "pilots", "products"].includes(eventStep);
  const currentPilot = board?.pilots.find((pilot) => pilot.id === pilotEditorId);
  const masterEditorDeleteAction: {
    entityType: MasterDataDeleteTarget["entityType"];
    entityId: string;
    label: string;
    description: string;
  } | null =
    masterDataCategory === "gates" && gateEditorId !== "new"
      ? {
          entityType: "GATE",
          entityId: gateEditorId,
          label: gateLabel,
          description: "Nur in der Vorbereitung und ohne operative Verwendung möglich.",
        }
      : masterDataCategory === "resource-groups" && resourceEditorId !== "new"
        ? {
            entityType: "RESOURCE_GROUP",
            entityId: resourceEditorId,
            label: resourceName,
            description: "Produkte und Flugzeugzuordnungen müssen vorher entfernt sein.",
          }
        : masterDataCategory === "aircraft" && aircraftEditorId !== "new"
          ? {
              entityType: "AIRCRAFT",
              entityId: aircraftEditorId,
              label: aircraftRegistration,
              description: "Eine bestehende Zuordnung muss zuerst entfernt werden.",
            }
          : masterDataCategory === "pilots" && pilotEditorId !== "new"
            ? {
                entityType: "PILOT",
                entityId: pilotEditorId,
                label: pilotCode,
                description: "Nur ohne Umlauf oder Flugzeugbindung möglich.",
              }
            : masterDataCategory === "products" && productEditorId !== "new"
              ? {
                  entityType: "PRODUCT",
                  entityId: productEditorId,
                  label: productName,
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
  const filteredEvents = events.filter((entry) =>
    `${entry.name} ${entry.eventId} ${entry.eventDate} ${entry.aerodrome}`
      .toLocaleLowerCase("de-DE")
      .includes(eventSearch.trim().toLocaleLowerCase("de-DE")),
  );
  const visibleEvents =
    eventSort.direction === null
      ? filteredEvents
      : filteredEvents.toSorted((left, right) => {
          const comparison = adminTableCollator.compare(
            String(left[eventSort.key]),
            String(right[eventSort.key]),
          );
          return eventSort.direction === "asc" ? comparison : -comparison;
        });

  function toggleEventSort(key: typeof eventSort.key) {
    setEventSort((current) =>
      current.key === key
        ? {
            key,
            direction:
              current.direction === "asc" ? "desc" : current.direction === "desc" ? null : "asc",
          }
        : { key, direction: "asc" },
    );
  }

  function openEventCreation() {
    setRestartMode("EMPTY");
    setRestartConfirmation("");
    setEventCreationError(null);
    setEventDialogView("create");
  }

  function closeEventDialog() {
    setEventDialogView("closed");
    setEventCreationError(null);
  }

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
            <ModalDialog
              bodyClassName={
                eventDialogView === "create"
                  ? "event-create-dialog-body"
                  : "event-catalog-dialog-body"
              }
              closeLabel={
                eventDialogView === "create"
                  ? "Veranstaltungsanlage schließen"
                  : "Veranstaltungsverwaltung schließen"
              }
              className="event-catalog-dialog"
              description={
                eventDialogView === "create"
                  ? "Veranstaltungsdaten, Datenbasis und Bestätigung in einem Schritt erfassen."
                  : "Veranstaltung auswählen, neu anlegen oder Stammdaten übertragen."
              }
              footer={
                eventDialogView === "create" ? (
                  <>
                    <Button onClick={() => setEventDialogView("catalog")} type="button">
                      Zurück zu Veranstaltungen
                    </Button>
                    <Button
                      busy={busyActionKey === "create-event"}
                      disabled={eventCreationDisabled}
                      form="event-create-form"
                      type="submit"
                      variant="primary"
                    >
                      Veranstaltung anlegen
                    </Button>
                  </>
                ) : undefined
              }
              footerClassName="event-create-dialog-footer"
              {...(eventDialogView === "create" ? { initialFocusSelector: "#new-event-id" } : {})}
              onClose={closeEventDialog}
              open={eventDialogView !== "closed"}
              size="wide"
              title={
                eventDialogView === "create"
                  ? "Neue Veranstaltung anlegen"
                  : "Veranstaltungen verwalten"
              }
            >
              {eventDialogView === "catalog" ? (
                <Panel className="event-catalog-v15 event-catalog-primary" padding="none">
                  <PageHeader
                    actions={
                      <div className="event-catalog-actions">
                        <SearchField
                          label="Veranstaltungen durchsuchen"
                          onChange={(event) => setEventSearch(event.target.value)}
                          placeholder="Veranstaltungen suchen …"
                          value={eventSearch}
                        />
                        <Button
                          busy={busyActionKey === "export-master-data-template"}
                          disabled={!board || busyActionKey !== null}
                          onClick={() =>
                            void runBusyAction(
                              "export-master-data-template",
                              exportMasterDataTemplate,
                            )
                          }
                          size="compact"
                        >
                          Stammdaten exportieren
                        </Button>
                        <Button
                          disabled={!board || !isAdministrator}
                          onClick={() => {
                            setTemplateDraft(null);
                            setTemplateValidation(null);
                            setTemplateError(null);
                            setTemplateFileName("");
                            setTemplateDialogOpen(true);
                          }}
                          size="compact"
                        >
                          Stammdaten importieren
                        </Button>
                        <Button
                          disabled={!isAdministrator}
                          onClick={openEventCreation}
                          size="compact"
                          variant="primary"
                        >
                          <Plus aria-hidden="true" /> Neue Veranstaltung
                        </Button>
                      </div>
                    }
                    level={2}
                    title="Veranstaltungen"
                  />
                  <div className="event-catalog-table-wrap">
                    <table className="event-catalog-table">
                      <thead>
                        <tr>
                          {(
                            [
                              ["name", "Veranstaltungsname"],
                              ["eventDate", "Datum"],
                              ["status", "Phase"],
                              ["aerodrome", "Flugplatz"],
                            ] as const
                          ).map(([key, label]) => (
                            <th
                              aria-sort={
                                eventSort.key === key && eventSort.direction
                                  ? eventSort.direction === "asc"
                                    ? "ascending"
                                    : "descending"
                                  : "none"
                              }
                              key={key}
                            >
                              <button
                                className="admin-sort-button"
                                onClick={() => toggleEventSort(key)}
                                type="button"
                              >
                                {label}
                                <span aria-hidden="true">
                                  {eventSort.key === key && eventSort.direction
                                    ? eventSort.direction === "asc"
                                      ? "↑"
                                      : "↓"
                                    : "↕"}
                                </span>
                              </button>
                            </th>
                          ))}
                          <th>Zeitzone</th>
                          <th>
                            <span className="visually-hidden">Aktionen</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleEvents.map((entry) => (
                          <tr
                            aria-selected={entry.eventId === EVENT_ID}
                            className={entry.eventId === EVENT_ID ? "is-current" : ""}
                            key={entry.eventId}
                          >
                            <td>
                              <div className="event-catalog-name">
                                <a
                                  href={`/admin?event=${encodeURIComponent(entry.eventId)}&area=events&step=${eventStep}`}
                                >
                                  {entry.name}
                                </a>
                                <span className="event-catalog-entry-id">
                                  Technische ID: <code>{entry.eventId}</code>
                                </span>
                              </div>
                            </td>
                            <td>{formatGermanDate(entry.eventDate)}</td>
                            <td>
                              {entry.status === "PREPARATION"
                                ? "Vorbereitung"
                                : entry.status === "ACTIVE"
                                  ? "Aktiv"
                                  : entry.status === "CLOSED"
                                    ? "Geschlossen"
                                    : "Archiviert"}
                            </td>
                            <td>{entry.aerodrome || "–"}</td>
                            <td>{entry.timeZone}</td>
                            <td>
                              <Button
                                aria-label={`${entry.name} löschen`}
                                busy={busyActionKey === `delete-event-${entry.eventId}`}
                                onClick={() =>
                                  void runBusyAction(`delete-event-${entry.eventId}`, () =>
                                    removeEvent(entry.eventId, entry.name, entry.version),
                                  )
                                }
                                size="compact"
                                variant="danger"
                              >
                                <Trash2 aria-hidden="true" /> Löschen
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {visibleEvents.length === 0 ? (
                      <p className="event-catalog-empty">Keine passende Veranstaltung gefunden.</p>
                    ) : null}
                  </div>
                </Panel>
              ) : eventDialogView === "create" ? (
                <form
                  className="event-create-dialog-form"
                  id="event-create-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (eventCreationDisabled) return;
                    void runBusyAction("create-event", createEventFromTemplate);
                  }}
                >
                  <div className="event-create-source">
                    <div>
                      <span>Ausgangsveranstaltung</span>
                      <strong>{board?.event.name ?? EVENT_ID}</strong>
                    </div>
                    <code>{EVENT_ID}</code>
                  </div>

                  <section className="event-create-section">
                    <div className="event-create-section-heading">
                      <h3>Veranstaltungsdaten</h3>
                      <p>Die technische ID ist die eindeutige, URL-taugliche Kennung.</p>
                    </div>
                    <div className="event-create-form-grid">
                      <div className="field-control">
                        <FieldLabel
                          htmlFor="new-event-id"
                          label="Technische ID"
                          help="3–64 Kleinbuchstaben, Ziffern oder Bindestriche; zum Beispiel rundflug-2027."
                        />
                        <input
                          autoCapitalize="none"
                          id="new-event-id"
                          maxLength={64}
                          onChange={(event) => setNewEventId(event.target.value.toLowerCase())}
                          pattern="[a-z0-9-]{3,64}"
                          placeholder="rundflug-2027"
                          required
                          spellCheck={false}
                          value={newEventId}
                        />
                      </div>
                      <div className="field-control">
                        <FieldLabel
                          htmlFor="new-event-name"
                          label="Bezeichnung"
                          help="Lesbarer Veranstaltungsname für Administration, Kasse und Anzeigen."
                        />
                        <input
                          id="new-event-name"
                          minLength={3}
                          onChange={(event) => setNewEventName(event.target.value)}
                          placeholder="Flugtag 2027"
                          required
                          value={newEventName}
                        />
                      </div>
                      <LocalizedDateInput
                        label="Datum"
                        labelContent={
                          <FieldGroupLabel
                            label="Datum"
                            help="Veranstaltungstag im deutschen Format TT.MM.JJJJ."
                          />
                        }
                        value={newEventDate}
                        onChange={setNewEventDate}
                      />
                      <div className="field-control">
                        <FieldLabel
                          htmlFor="new-event-aerodrome"
                          label="Flugplatz"
                          help="Kurze Flugplatzkennung oder Ortsangabe für die Veranstaltung."
                        />
                        <input
                          id="new-event-aerodrome"
                          minLength={2}
                          onChange={(event) => setNewEventAerodrome(event.target.value)}
                          placeholder="EDXX"
                          required
                          value={newEventAerodrome}
                        />
                      </div>
                    </div>
                  </section>

                  <section className="event-create-section">
                    <div className="event-create-section-heading">
                      <h3>Datenbasis</h3>
                      <p>Bestimmt, ob die neue Veranstaltung vorhandene Stammdaten übernimmt.</p>
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="restart-mode"
                        label="Datenbasis"
                        help="Betriebsdaten wie Tickets, Gruppen, Umläufe und Flugdaten beginnen immer leer."
                      />
                      <select
                        id="restart-mode"
                        onChange={(event) =>
                          setRestartMode(event.target.value as "KEEP_MASTER_DATA" | "EMPTY")
                        }
                        value={restartMode}
                      >
                        <option value="KEEP_MASTER_DATA">Stammdaten übernehmen</option>
                        <option value="EMPTY">Leer anlegen</option>
                      </select>
                    </div>
                    <p className="help-text event-create-mode-help">
                      {restartMode === "KEEP_MASTER_DATA"
                        ? "Übernommen werden Parameter, Gates, Ressourcengruppen, Produkte, Flugzeugzuordnungen und Piloten-IDs. Verkäufe bleiben zunächst gesperrt."
                        : "Nur Veranstaltungsdaten, Grundeinstellungen und das erste Administrationskonto werden angelegt. Alle Stammdaten beginnen leer."}
                    </p>
                  </section>

                  <section className="event-create-section event-create-confirmation">
                    <div className="event-create-section-heading">
                      <h3>Bestätigung</h3>
                      <p>
                        Zum Schutz vor einem versehentlichen Neustart muss NEUSTART eingegeben
                        werden.
                      </p>
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="restart-confirmation"
                        label="Bestätigungstext"
                        help="Exakt NEUSTART in Großbuchstaben eingeben."
                      />
                      <input
                        autoComplete="off"
                        id="restart-confirmation"
                        onChange={(event) => setRestartConfirmation(event.target.value)}
                        placeholder="NEUSTART"
                        value={restartConfirmation}
                      />
                    </div>
                  </section>

                  {eventCreationError ? (
                    <ValidationHint tone="error">{eventCreationError}</ValidationHint>
                  ) : null}
                </form>
              ) : null}
            </ModalDialog>
          ) : null}
          {adminArea === "events" ? (
            <SetupProgress currentStepId={eventStep} onSelect={openSetupStep} steps={setupSteps} />
          ) : null}
          {/* biome-ignore format: preserve the large existing workspace subtree while adding its scroll boundary */}
          <div className="admin-workspace-scroll-region" ref={adminWorkspaceScrollRef}>
            {board?.currentDeviceRole === "FLIGHT_DIRECTOR" ? (
              <div className="readonly-banner">Flight-Director-Ansicht · primär lesend</div>
            ) : null}
            {board ? (
              <>
              {adminArea === "overview" ? (
              <div>
                <AdminEventFlowChart
                  averageWaitMinutes={board.metrics.averageWaitMinutes}
                  error={eventFlowError}
                  flow={eventFlow}
                  loading={eventFlowLoading}
                  timeZone={board.event.timeZone}
                />
              </div>
              ) : null}
              <section
                aria-label="Betriebskennzahlen"
                className="metrics-grid"
                hidden={adminArea !== "overview"}
              >
                <div>
                  <strong>{board.metrics.openTickets}</strong>
                  <span>offene Tickets</span>
                </div>
                <div>
                  <strong>{board.metrics.activeRotations}</strong>
                  <span>aktive Umläufe</span>
                </div>
                <div>
                  <strong>{board.metrics.completedRotations}</strong>
                  <span>abgeschlossen</span>
                </div>
                <div>
                  <strong>{board.metrics.averageBoardingMinutes ?? "–"}</strong>
                  <span>Ø Boarding Min.</span>
                </div>
                <div>
                  <strong>{board.metrics.averageFlightMinutes ?? "–"}</strong>
                  <span>Ø Flug Min.</span>
                </div>
                <div>
                  <strong>{board.metrics.averageTurnaroundMinutes ?? "–"}</strong>
                  <span>Ø Landung–frei Min.</span>
                </div>
                <div>
                  <strong>{board.metrics.averageRotationMinutes ?? "–"}</strong>
                  <span>Ø Boarding-Aufruf–frei Min.</span>
                </div>
                <div>
                  <strong>{board.metrics.averageWaitMinutes ?? "–"}</strong>
                  <span>Ø Verkauf–Boarding-Aufruf Min.</span>
                </div>
                <div>
                  <strong>
                    {(board.metrics.informationalRevenueCents / 100).toLocaleString("de-DE", {
                      style: "currency",
                      currency: "EUR",
                    })}
                  </strong>
                  <span>informatorischer Umsatz</span>
                </div>
                <div>
                  <strong>{board.metrics.activeDevices}</strong>
                  <span>Aktive Sitzungen</span>
                </div>
                <div>
                  <strong>
                    {pushConfigurationStatus === "configured"
                      ? board.metrics.activePushSubscriptions
                      : pushConfigurationStatus === "loading"
                        ? "…"
                        : "–"}
                  </strong>
                  <span>
                    {pushConfigurationStatus === "configured"
                      ? "Web-Push aktiv"
                      : pushConfigurationStatus === "missing"
                        ? "Web-Push fehlt"
                        : pushConfigurationStatus === "loading"
                          ? "Web-Push wird geprüft"
                          : "Web-Push nicht geprüft"}
                  </span>
                </div>
              </section>
              {adminArea === "overview" && pushConfigurationStatus === "missing" ? (
                <ValidationHint tone="warning">
                  <strong>Web-Push ist noch nicht eingerichtet.</strong> VAPID-Secrets mit{" "}
                  <code>npm run cloudflare:configure-push</code> setzen und danach auf einem echten
                  Besuchergerät testen.
                </ValidationHint>
              ) : null}
              </>
            ) : null}
          <section
            className={`admin-edit-context admin-mode-bar ${adminModeUnlocked ? "unlocked" : "locked"}`}
          >
            <div>
              <strong>
                {session?.account.role === "ADMIN"
                  ? "Administration aktiv"
                  : adminModeUnlocked
                    ? "Bearbeitungsmodus aktiv"
                    : "Administration gesperrt"}
              </strong>
              <span>
                {session?.account.role === "ADMIN"
                  ? `${session.account.loginCode} · Änderungen werden dem angemeldeten Konto zugeordnet.`
                  : adminModeUnlocked
                    ? "Mehrere Änderungen sind möglich. Jede Änderung wird weiterhin einzeln protokolliert."
                    : "Änderungen fragen die PIN einzeln ab oder können für diese Arbeitssitzung entsperrt werden."}
              </span>
            </div>
            {isAdministrator ? (
              <Button
                busy={session?.account.role === "ADMIN" && logoutBusy}
                className="secondary-action"
                onClick={() => {
                  if (session?.account.role === "ADMIN") {
                    void logoutAndReload();
                  } else if (adminModeUnlocked) lockAdminMode();
                  else requestAdminModeUnlock();
                }}
                type="button"
              >
                {session?.account.role === "ADMIN"
                  ? "Abmelden"
                  : adminModeUnlocked
                    ? "Bearbeitungsmodus sperren"
                    : "Bearbeitungsmodus entsperren"}
              </Button>
            ) : (
              <div className="secondary-actions admin-recovery-actions">
                <Button
                  busy={refreshing}
                  className="secondary-action"
                  onClick={() => void refresh()}
                  type="button"
                >
                  Erneut laden
                </Button>
                <Button
                  busy={logoutBusy}
                  className="secondary-action"
                  disabled={refreshing}
                  onClick={() => void logoutAndReload()}
                  type="button"
                >
                  Mit Administrationskonto anmelden
                </Button>
              </div>
            )}
            {!isAdministrator ? (
              error ? (
                <ValidationHint tone="error">
                  Der Betriebsstand konnte nicht geladen werden. Erneut laden oder mit einem
                  Administrationskonto anmelden; vorhandene Betriebsdaten bleiben unverändert.
                </ValidationHint>
              ) : (
                <ValidationHint>Sitzung und Betriebsstand werden geprüft.</ValidationHint>
              )
            ) : null}
            <ValidationHint>
              {session?.account.role === "ADMIN"
                ? "Die Anmeldung ersetzt wiederholte PIN-Abfragen. Jede Änderung bleibt einzeln protokolliert."
                : adminModeUnlocked
                  ? "Änderungen sind freigeschaltet und werden automatisch protokolliert."
                  : "Beim Auslösen einer administrativen Änderung erscheint die PIN-Abfrage."}
            </ValidationHint>
          </section>
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

          <Panel className="event-catalog-v15" hidden padding="none">
            <PageHeader
              actions={
                <div className="event-catalog-actions">
                  <SearchField
                    label="Veranstaltungen durchsuchen"
                    onChange={(event) => setEventSearch(event.target.value)}
                    placeholder="Veranstaltungen suchen …"
                    value={eventSearch}
                  />
                  <Button
                    disabled={!isAdministrator}
                    onClick={openEventCreation}
                    variant="primary"
                  >
                    <Plus aria-hidden="true" /> Neue Veranstaltung
                  </Button>
                </div>
              }
              level={2}
              title="Veranstaltungen"
            />
            <div className="event-catalog-table-wrap">
              <table className="event-catalog-table">
                <thead>
                  <tr>
                    <th>Veranstaltungsname</th>
                    <th>Datum</th>
                    <th>Phase</th>
                    <th>Zeitzone</th>
                    <th>Flugplatz</th>
                    <th>
                      <span className="visually-hidden">Aktionen</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events
                    .filter((entry) =>
                      `${entry.name} ${entry.eventId} ${entry.eventDate} ${entry.aerodrome}`
                        .toLocaleLowerCase("de-DE")
                        .includes(eventSearch.trim().toLocaleLowerCase("de-DE")),
                    )
                    .map((entry) => (
                      <tr
                        className={entry.eventId === EVENT_ID ? "is-current" : ""}
                        key={entry.eventId}
                      >
                        <td>
                          <div className="event-catalog-name">
                            <a
                              href={`/admin?event=${encodeURIComponent(entry.eventId)}&area=events&step=event`}
                            >
                              {entry.name}
                            </a>
                            <span className="event-catalog-entry-id">
                              Technische ID: <code>{entry.eventId}</code>
                            </span>
                          </div>
                        </td>
                        <td>{formatGermanDate(entry.eventDate)}</td>
                        <td>
                          {entry.status === "PREPARATION"
                            ? "Vorbereitung"
                            : entry.status === "ACTIVE"
                              ? "Aktiv"
                              : "Geschlossen"}
                        </td>
                        <td>{entry.timeZone}</td>
                        <td>{entry.aerodrome || "–"}</td>
                        <td>
                          <Button
                            aria-label={`${entry.name} löschen`}
                            busy={busyActionKey === `delete-event-${entry.eventId}`}
                            onClick={() =>
                              void runBusyAction(`delete-event-${entry.eventId}`, () =>
                                removeEvent(entry.eventId, entry.name, entry.version),
                              )
                            }
                            size="compact"
                            variant="danger"
                          >
                            <Trash2 aria-hidden="true" /> Löschen
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Panel>
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
              newLabel={`${masterDataSingularLabel[masterDataCategory]} anlegen`}
              onNew={startNewMasterDataEntry}
              onSearchChange={setMasterSearch}
              resultCount={activeMasterDataRows.length}
              search={masterSearch}
            >
              {masterDataCategory === "gates" ? (
                <GatesWorkspace
                  board={board}
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
                  onDelete={(id, label) => requestMasterDelete("PRODUCT", id, label)}
                  onEdit={selectProductForEditing}
                  onSort={toggleMasterSort}
                  onTurnaround={(productId) =>
                    setTurnaroundDialogContext({ mode: "product", productId })
                  }
                  rows={pagedProducts}
                  sortDirection={masterSort.category === "products" ? masterSort.direction : null}
                  sortKey={masterSort.category === "products" ? masterSort.key : undefined}
                />
              ) : null}
              {activeMasterDataRows.length === 0 ? (
                <MasterDataEmptyState
                  action={
                    totalMasterDataCount === 0 ? (
                      <Button onClick={startNewMasterDataEntry} type="button" variant="primary">
                        <Plus aria-hidden="true" />
                        {masterDataSingularLabel[masterDataCategory]} anlegen
                      </Button>
                    ) : (
                      <Button
                        onClick={() => {
                          setMasterSearch("");
                          setResourceStatusFilter("ALL");
                        }}
                        type="button"
                      >
                        Filter zurücksetzen
                      </Button>
                    )
                  }
                  description={
                    totalMasterDataCount === 0
                      ? "Für diese Veranstaltung sind noch keine Einträge vorhanden."
                      : "Die aktuelle Suche oder Filterauswahl liefert keine Einträge."
                  }
                  title={totalMasterDataCount === 0 ? "Noch keine Stammdaten" : "Keine Treffer"}
                />
              ) : null}
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
          <ModalDialog
            bodyClassName="master-data-editor-body"
            className="master-data-editor-dialog"
            footer={masterEditorFooter}
            footerClassName="master-data-editor-footer"
            initialFocusSelector={masterEditorInitialFocusSelector}
            onClose={requestMasterEditorClose}
            open={
              masterDataStepActive &&
              masterEditorOpen &&
              ["gates", "products"].includes(masterDataCategory)
            }
            size="wide"
            title={
              masterDataCategory === "gates"
                ? gateEditorId === "new"
                  ? "Gate anlegen"
                  : "Gate bearbeiten"
                : productEditorId === "new"
                  ? "Produkt anlegen"
                  : "Produkt bearbeiten"
            }
          >
            <div className="master-data-columns">
              {masterDataCategory === "gates" ? (
              <fieldset>
                <legend>Gate</legend>
                <Tabs
                  idPrefix="master-gate-editor"
                  items={[
                    { value: "general", label: "Grunddaten" },
                    { value: "details", label: "Öffentliche Anzeige" },
                  ]}
                  label="Gate-Bereiche"
                  onChange={setMasterEditorTab}
                  value={masterEditorTab}
                />
                <div
                  aria-labelledby="master-gate-editor-general-tab"
                  hidden={masterEditorTab !== "general"}
                  id="master-gate-editor-general-panel"
                  role="tabpanel"
                >
                <p className="form-introduction">
                  Ein Gate ist der sichtbare Treff- oder Ausgabepunkt einer Ressourcengruppe. Für
                  den normalen Betrieb genügt eine Bezeichnung; technische Gate-Arten sind nicht
                  erforderlich.
                </p>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="gate-label"
                    label="Bezeichnung"
                    help="Kurzer, vor Ort eindeutig sichtbarer Name, zum Beispiel Eingang Halle oder Flight Line Nord."
                  />
                  <input
                    id="gate-label"
                    value={gateLabel}
                    onChange={(event) => setGateLabel(event.target.value)}
                  />
                </div>
                <div className="gate-active-field">
                  <FieldGroupLabel
                    label="Status"
                    help="Nur aktive Gates stehen für neue Zuordnungen und öffentliche Anzeigen zur Verfügung."
                  />
                  <CheckboxField
                    checked={gateActive}
                    label="Gate ist aktiv"
                    onChange={(event) => setGateActive(event.target.checked)}
                  />
                </div>
                <details className="master-editor-further-settings">
                  <summary>Weitere Einstellungen</summary>
                  <div className="parameter-grid">
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="gate-type"
                        label="Technische Gate-Art"
                        help="Kompatibler technischer Schlüssel; für den normalen Ablauf ist Flight Line passend."
                      />
                      <select
                        id="gate-type"
                        onChange={(event) =>
                          setGateType(
                            event.target.value as "FLIGHT_LINE" | "BOARDING" | "DISPLAY_ONLY",
                          )
                        }
                        value={gateType}
                      >
                        <option value="FLIGHT_LINE">Flight Line</option>
                        <option value="BOARDING">Boarding</option>
                        <option value="DISPLAY_ONLY">Nur Anzeige</option>
                      </select>
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="gate-sort-order"
                        label="Reihenfolge"
                        help="Kleinere Werte erscheinen zuerst."
                      />
                      <input
                        id="gate-sort-order"
                        min="0"
                        onChange={(event) => setGateSortOrder(Number(event.target.value))}
                        type="number"
                        value={gateSortOrder}
                      />
                    </div>
                  </div>
                </details>
                </div>
                <section
                  aria-labelledby="master-gate-editor-details-tab"
                  className="gate-display-filter"
                  hidden={masterEditorTab !== "details"}
                  id="master-gate-editor-details-panel"
                  role="tabpanel"
                >
                  <div>
                    <h3 id="gate-display-filter-title">Anzeigefilter</h3>
                    <p>
                      Leere Auswahl bedeutet: alle Produkte beziehungsweise alle Umlaufstatus
                      anzeigen.
                    </p>
                  </div>
                  <div className="gate-filter-group">
                    <strong>
                      <FieldGroupLabel
                        label="Produkte"
                        help="Begrenzt die öffentliche Gate-Anzeige auf die ausgewählten Produkte. Die Ressourcenzuordnung bleibt unverändert."
                      />
                    </strong>
                    <div className="gate-filter-options">
                      {alphabeticalProducts.map((product) => (
                        <CheckboxField
                          checked={gateDisplayProductIds.includes(product.id)}
                          key={product.id}
                          label={product.name}
                          onChange={() =>
                            setGateDisplayProductIds((current) =>
                              current.includes(product.id)
                                ? current.filter((id) => id !== product.id)
                                : [...current, product.id],
                            )
                          }
                        />
                      ))}
                      {board?.products.length === 0 ? (
                        <span className="help-text">Noch keine Produkte angelegt.</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="gate-filter-group">
                    <strong>
                      <FieldGroupLabel
                        label="Umlaufstatus"
                        help="Begrenzt die Anzeige auf die gewählten Phasen. Diese Auswahl löst keine Zustandsänderung aus."
                      />
                    </strong>
                    <div className="gate-filter-options">
                      {(
                        [
                          ["DRAFT", "Vorbereitung"],
                          ["CALLED", "Aufgerufen"],
                          ["IN_FLIGHT", "Im Flug"],
                          ["LANDED", "Gelandet"],
                          ["COMPLETED", "Abgeschlossen"],
                        ] as const
                      ).map(([status, label]) => (
                        <CheckboxField
                          checked={gateDisplayRotationStatuses.includes(status)}
                          key={status}
                          label={label}
                          onChange={() =>
                            setGateDisplayRotationStatuses((current) =>
                              current.includes(status)
                                ? current.filter((entry) => entry !== status)
                                : [...current, status],
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                  {gateEditorId !== "new" ? (
                    <div className="gate-assignment-summary">
                      <strong>Zugeordnete Ressourcengruppen</strong>
                      <span>
                        {resourceGroups
                          .filter((group) => group.gateId === gateEditorId)
                          .map((group) => group.name)
                          .join(", ") || "Keine"}
                      </span>
                      <small>Zuordnungen werden bei der Ressourcengruppe gepflegt.</small>
                    </div>
                  ) : null}
                </section>
                {masterSubmitAttempted && gateLabel.trim().length < 2 ? (
                  <ValidationHint tone="error">
                    Die Gate-Bezeichnung muss mindestens 2 Zeichen lang sein.
                  </ValidationHint>
                ) : null}
              </fieldset>
              ) : null}
              {masterDataCategory === "products" ? (
              <fieldset>
                <legend>Produkt</legend>
                <Tabs
                  idPrefix="master-product-editor"
                  items={[
                    { value: "general", label: "Allgemein" },
                    { value: "details", label: "Planung und Zeitmodell" },
                  ]}
                  label="Produktbereiche"
                  onChange={setMasterEditorTab}
                  value={masterEditorTab}
                />
                <section
                  aria-labelledby="master-product-editor-general-tab"
                  className="product-editor-section"
                  hidden={masterEditorTab !== "general"}
                  id="master-product-editor-general-panel"
                  role="tabpanel"
                >
                  <h3>Allgemein</h3>
                  <div className="parameter-grid">
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="product-name"
                        label="Bezeichnung"
                        help="Interner und öffentlicher Name des Produkts."
                      />
                      <input
                        id="product-name"
                        value={productName}
                        onChange={(event) => setProductName(event.target.value)}
                      />
                      {masterSubmitAttempted && productName.trim().length < 2 ? (
                        <span className="field-error">Mindestens 2 Zeichen eingeben.</span>
                      ) : null}
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="product-code"
                        label="Kürzel"
                        help="2–12 Großbuchstaben, Ziffern oder Bindestriche; Bestandteil der stabilen Fluggruppenkennung."
                      />
                      <input
                        id="product-code"
                        value={productCode}
                        maxLength={12}
                        onChange={(event) => setProductCode(event.target.value.toUpperCase())}
                      />
                      {masterSubmitAttempted && !/^[A-Z0-9-]{2,12}$/.test(productCode) ? (
                        <span className="field-error">Zum Beispiel PAN20 oder KURZ-10.</span>
                      ) : null}
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="product-price"
                        label="Preis in €"
                        help="Informatorischer Einzelpreis je Ticket. Das System ist keine elektronische Kasse."
                      />
                      <input
                        id="product-price"
                        inputMode="decimal"
                        value={productPriceInput}
                        onBlur={() => {
                          const cents = parseEuroToCents(productPriceInput);
                          if (cents !== null) setProductPriceInput(formatEuroInput(cents));
                        }}
                        onChange={(event) => setProductPriceInput(event.target.value)}
                      />
                      {masterSubmitAttempted && productPriceCents === null ? (
                        <span className="field-error">
                          Eurobetrag mit höchstens zwei Nachkommastellen eingeben.
                        </span>
                      ) : null}
                    </div>
                    <div className="field-control product-description-field">
                      <FieldLabel
                        htmlFor="product-description"
                        label="Öffentliche Beschreibung"
                        help="Kurzer Text für Kasse und öffentliche Anzeigen."
                      />
                      <input
                        id="product-description"
                        value={productDescription}
                        maxLength={240}
                        onChange={(event) => setProductDescription(event.target.value)}
                      />
                    </div>
                  </div>
                </section>
                <section
                  aria-labelledby="master-product-editor-details-tab"
                  className="product-editor-section"
                  hidden={masterEditorTab !== "details"}
                  id="master-product-editor-details-panel"
                  role="tabpanel"
                >
                  <h3>Planung und Zeitmodell</h3>
                  <div className="parameter-grid">
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="product-resource-group"
                        label="Ressourcengruppe"
                        help="Ordnet das Produkt genau einer gemeinsamen operativen Queue und Kapazität zu."
                      />
                      <select
                        id="product-resource-group"
                        value={productResourceGroupId}
                        onChange={(event) => setProductResourceGroupId(event.target.value)}
                      >
                        <option value="">Bitte wählen</option>
                        {resourceGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                      {masterSubmitAttempted && !productResourceGroupId ? (
                        <span className="field-error">Eine Ressourcengruppe auswählen.</span>
                      ) : null}
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="product-gate"
                        label="Gate"
                        help="Veröffentlichter Treffpunkt beziehungsweise Abfertigungsort."
                      />
                      <select
                        id="product-gate"
                        value={productGateId}
                        onChange={(event) => setProductGateId(event.target.value)}
                      >
                        <option value="">Bitte wählen</option>
                        {board?.gates
                          .filter((gate) => gate.active)
                          .map((gate) => (
                            <option key={gate.id} value={gate.id}>
                              {gate.label}
                            </option>
                          ))}
                      </select>
                      {masterSubmitAttempted && !productGateId ? (
                        <span className="field-error">Ein aktives Gate auswählen.</span>
                      ) : null}
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="product-reference-duration"
                        label="Referenzzeit Offblock–Onblock (Min.)"
                        help="Operative Planzeit vom bestätigten Offblock bis zum bestätigten Onblock. Boarding, Ausstieg und Puffer werden separat berücksichtigt. Trage hier weder die vollständige Umlaufzeit noch ausschließlich die beworbene Flugzeit ein."
                      />
                      <input
                        id="product-reference-duration"
                        type="number"
                        min="1"
                        max="600"
                        value={productReferenceDuration}
                        onChange={(event) =>
                          setProductReferenceDuration(Number(event.target.value))
                        }
                      />
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="product-promised-flight-minutes"
                        label="Kommunizierte Flugzeit (Min.)"
                        help="Gegenüber Gästen angegebene beziehungsweise verkaufte Flugzeit. Dieser Wert wird in Produktinformationen verwendet und beeinflusst die operative Prognose nicht."
                      />
                      <input
                        id="product-promised-flight-minutes"
                        type="number"
                        min="1"
                        max="600"
                        value={productPromisedFlightMinutes}
                        onChange={(event) =>
                          setProductPromisedFlightMinutes(Number(event.target.value))
                        }
                      />
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="product-boarding-override"
                        label="Boarding (Min.)"
                        help="Leer übernimmt den Veranstaltungswert."
                      />
                      <input
                        id="product-boarding-override"
                        max="120"
                        min="0"
                        onChange={(event) => setProductBoardingOverride(event.target.value)}
                        placeholder={`Veranstaltung: ${board?.event.plannedBoardingMinutes ?? 8}`}
                        type="number"
                        value={productBoardingOverride}
                      />
                      <small>
                        Quelle: {productBoardingOverride === "" ? "Veranstaltung" : "Produkt"}
                      </small>
                      <button
                        className="table-action"
                        onClick={() =>
                          setProductBoardingOverride((current) =>
                            current === "" ? String(board?.event.plannedBoardingMinutes ?? 8) : "",
                          )
                        }
                        type="button"
                      >
                        {productBoardingOverride === ""
                          ? "Produktabweichung festlegen"
                          : "Produktabweichung entfernen"}
                      </button>
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="product-deboarding-override"
                        label="Ausstieg (Min.)"
                        help="Leer übernimmt den Veranstaltungswert."
                      />
                      <input
                        id="product-deboarding-override"
                        max="120"
                        min="0"
                        onChange={(event) => setProductDeboardingOverride(event.target.value)}
                        placeholder={`Veranstaltung: ${board?.event.plannedDeboardingMinutes ?? 5}`}
                        type="number"
                        value={productDeboardingOverride}
                      />
                      <small>
                        Quelle: {productDeboardingOverride === "" ? "Veranstaltung" : "Produkt"}
                      </small>
                      <button
                        className="table-action"
                        onClick={() =>
                          setProductDeboardingOverride((current) =>
                            current === "" ? String(board?.event.plannedDeboardingMinutes ?? 5) : "",
                          )
                        }
                        type="button"
                      >
                        {productDeboardingOverride === ""
                          ? "Produktabweichung festlegen"
                          : "Produktabweichung entfernen"}
                      </button>
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="product-buffer-override"
                        label="Puffer (Min.)"
                        help="Leer übernimmt den Veranstaltungswert."
                      />
                      <input
                        id="product-buffer-override"
                        max="120"
                        min="0"
                        onChange={(event) => setProductBufferOverride(event.target.value)}
                        placeholder={`Veranstaltung: ${board?.event.plannedBufferMinutes ?? 3}`}
                        type="number"
                        value={productBufferOverride}
                      />
                      <small>
                        Quelle: {productBufferOverride === "" ? "Veranstaltung" : "Produkt"}
                      </small>
                      <button
                        className="table-action"
                        onClick={() =>
                          setProductBufferOverride((current) =>
                            current === "" ? String(board?.event.plannedBufferMinutes ?? 3) : "",
                          )
                        }
                        type="button"
                      >
                        {productBufferOverride === ""
                          ? "Produktabweichung festlegen"
                          : "Produktabweichung entfernen"}
                      </button>
                    </div>
                    <ProductReferenceRotation
                      boardingMinutes={
                        productBoardingOverride === ""
                          ? (board?.event.plannedBoardingMinutes ?? 8)
                          : Number(productBoardingOverride)
                      }
                      bufferMinutes={
                        productBufferOverride === ""
                          ? (board?.event.plannedBufferMinutes ?? 3)
                          : Number(productBufferOverride)
                      }
                      deboardingMinutes={
                        productDeboardingOverride === ""
                          ? (board?.event.plannedDeboardingMinutes ?? 5)
                          : Number(productDeboardingOverride)
                      }
                      offBlockToOnBlockMinutes={productReferenceDuration}
                    />
                  </div>
                </section>
              </fieldset>
              ) : null}
            </div>
            {masterEditorMobileFurtherActions}
          </ModalDialog>
          <ModalDialog
            bodyClassName="master-data-editor-body"
            className="master-data-editor-dialog"
            footer={masterEditorFooter}
            footerClassName="master-data-editor-footer"
            initialFocusSelector={masterEditorInitialFocusSelector}
            onClose={requestMasterEditorClose}
            open={
              masterDataStepActive &&
              masterEditorOpen &&
              ["resource-groups", "aircraft"].includes(masterDataCategory)
            }
            size={masterDataCategory === "resource-groups" ? "wide" : "default"}
            title={
              masterDataCategory === "resource-groups"
                ? resourceEditorId === "new"
                  ? "Ressourcengruppe anlegen"
                  : "Ressourcengruppe bearbeiten"
                : aircraftEditorId === "new"
                    ? "Flugzeug anlegen"
                    : "Flugzeug bearbeiten"
            }
          >
            <div className="resource-master-grid">
              <fieldset hidden={masterDataCategory !== "resource-groups"}>
                <legend>Ressourcengruppe</legend>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="resource-name"
                    label="Bezeichnung"
                    help="Lesbarer Name der gemeinsamen operativen Warteschlange."
                  />
                  <input
                    id="resource-name"
                    value={resourceName}
                    onChange={(event) => setResourceName(event.target.value)}
                  />
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="resource-short-code"
                    label="Kurzzeichen"
                    help="Eindeutiges Kürzel mit 2 bis 8 Großbuchstaben, Ziffern oder Bindestrichen für kompakte operative Ansichten."
                  />
                  <input
                    autoCapitalize="characters"
                    id="resource-short-code"
                    maxLength={8}
                    placeholder="z. B. PA"
                    value={resourceShortCode}
                    onChange={(event) =>
                      setResourceShortCode(
                        event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""),
                      )
                    }
                  />
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="resource-gate"
                    label="Gate"
                    help="Standardmäßiger Treffpunkt für Produkte und Umläufe dieser Ressourcengruppe."
                  />
                  <select
                    id="resource-gate"
                    value={resourceGateId}
                    onChange={(event) => setResourceGateId(event.target.value)}
                  >
                    <option value="">Bitte wählen</option>
                    {board?.gates
                      .filter((gate) => gate.active)
                      .map((gate) => (
                        <option key={gate.id} value={gate.id}>
                          {gate.label}
                        </option>
                      ))}
                  </select>
                </div>
                <CheckboxField
                  checked={resourceAutomaticPrecall}
                  className="resource-automatic-precall"
                  id="resource-automatic-precall"
                  label="Automatischer Voraufruf für diese Gruppe"
                  onChange={(event) => setResourceAutomaticPrecall(event.target.checked)}
                  trailing={
                    <FieldHelp help="Kann für einzelne Ressourcengruppen abgeschaltet werden. Belegung, Pilot und Boarding bleiben immer manuell bestätigt." />
                  }
                />
                <section className="resource-aircraft-selection resource-assignment-summary">
                  <h3>Flugzeugzuordnungen</h3>
                  <p>
                    Zuordnungen werden getrennt historisiert und beim Speichern der
                    Ressourcengruppe nicht verändert.
                  </p>
                  {resourceEditorId !== "new" ? (
                    <Button
                      onClick={() =>
                        setAssignmentDialogContext({
                          mode: "resource-group",
                          resourceGroupId: resourceEditorId,
                        })
                      }
                      type="button"
                      variant="secondary"
                    >
                      Flugzeug zuordnen
                    </Button>
                  ) : (
                    <ValidationHint>
                      Die Ressourcengruppe zuerst speichern und anschließend Flugzeuge zuordnen.
                    </ValidationHint>
                  )}
                </section>
                {masterSubmitAttempted &&
                (resourceName.trim().length < 2 ||
                  !/^[A-Z0-9-]{2,8}$/.test(resourceShortCode.trim().toUpperCase()) ||
                  !resourceGateId) ? (
                  <ValidationHint tone="error">
                    Bezeichnung, gültiges Kurzzeichen und Gate müssen für die Ressourcengruppe
                    angegeben werden.
                  </ValidationHint>
                ) : null}
              </fieldset>
              <fieldset hidden={masterDataCategory !== "aircraft"}>
                <legend>Flugzeug</legend>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="aircraft-registration"
                    label="Kennzeichen"
                    help="Eindeutiges operatives Luftfahrzeugkennzeichen, beispielsweise D-EXYZ."
                  />
                  <input
                    id="aircraft-registration"
                    value={aircraftRegistration}
                    maxLength={16}
                    onChange={(event) => setAircraftRegistration(event.target.value.toUpperCase())}
                  />
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="aircraft-type"
                    label="Flugzeugtyp"
                    help="Typbezeichnung zur Prüfung gegen kompatible Ressourcengruppen."
                  />
                  <input
                    id="aircraft-type"
                    value={aircraftType}
                    onChange={(event) => setAircraftType(event.target.value)}
                  />
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="aircraft-seats"
                    label="Passagierplätze"
                    help="Maximale Ticketanzahl je Umlauf; Besatzungsplätze werden hier nicht eingetragen."
                  />
                  <input
                    id="aircraft-seats"
                    type="number"
                    min="1"
                    max="100"
                    value={aircraftSeats}
                    onChange={(event) => setAircraftSeats(Number(event.target.value))}
                  />
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="aircraft-maximum-payload"
                    label="Max. Passagierzuladung (kg)"
                    help="Optionaler organisatorischer Hinweiswert. Er besitzt keine Freigabe- oder Sicherheitssemantik."
                  />
                  <input
                    id="aircraft-maximum-payload"
                    type="number"
                    min="1"
                    value={aircraftMaximumPayload}
                    onChange={(event) => setAircraftMaximumPayload(event.target.value)}
                  />
                </div>
                {aircraftEditorId !== "new" ? (
                  <dl className="master-editor-readonly-summary">
                    <div>
                      <dt>Betriebsstatus</dt>
                      <dd>
                        {aircraftStateLabel[
                          board?.aircraft.find((entry) => entry.id === aircraftEditorId)
                            ?.operationalState ?? "INACTIVE"
                        ]}
                      </dd>
                    </div>
                    <div>
                      <dt>Aktuelle Ressourcengruppe</dt>
                      <dd>
                        {board?.aircraft.find((entry) => entry.id === aircraftEditorId)
                          ?.resourceGroupName || "Nicht zugeordnet"}
                      </dd>
                    </div>
                    <div>
                      <dt>Produktspezifische Zeitabweichungen</dt>
                      <dd>
                        {board?.aircraftProductTurnaroundOverrides.filter(
                          (entry) => entry.aircraftId === aircraftEditorId,
                        ).length ?? 0}
                      </dd>
                    </div>
                  </dl>
                ) : null}
                {masterSubmitAttempted &&
                (aircraftRegistration.trim().length < 3 || aircraftType.trim().length < 2) ? (
                  <ValidationHint tone="error">
                    Kennzeichen und Flugzeugtyp müssen mindestens 2 Zeichen lang sein.
                  </ValidationHint>
                ) : null}
              </fieldset>
            </div>
            {masterEditorMobileFurtherActions}
          </ModalDialog>
          <ModalDialog
            bodyClassName="master-data-editor-body"
            className="master-data-editor-dialog"
            footer={masterEditorFooter}
            footerClassName="master-data-editor-footer"
            initialFocusSelector={masterEditorInitialFocusSelector}
            onClose={requestMasterEditorClose}
            open={masterDataStepActive && masterEditorOpen && masterDataCategory === "pilots"}
            size="default"
            title={pilotEditorId === "new" ? "Pilotencode anlegen" : "Pilotencode bearbeiten"}
          >
            <div className="parameter-grid compact-editor-grid">
              <div className="field-control">
                <FieldLabel
                  htmlFor="pilot-operational-code"
                  label="Operativer Pilotencode"
                  help="Anonymer technischer Code für die operative Zuordnung; keine Namen oder Lizenzdaten erfassen."
                />
                <input
                  id="pilot-operational-code"
                  value={pilotCode}
                  onChange={(event) => setPilotCode(event.target.value.toUpperCase())}
                />
                <span className="field-help">
                  Nur technische Codes, keine Namen oder Lizenzdaten.
                </span>
              </div>
              <div className="field-control">
                <FieldLabel
                  htmlFor="pilot-operational-note"
                  label="Organisatorische Bemerkung"
                  help="Optionaler nicht personenbezogener Hinweis, zum Beispiel Einsatzbereich oder Schicht."
                />
                <input
                  id="pilot-operational-note"
                  value={pilotNote}
                  onChange={(event) => setPilotNote(event.target.value)}
                  placeholder="Optional · keine personenbezogenen Daten"
                />
              </div>
            </div>
            <ValidationHint>
              Ausschließlich anonyme operative Codes erfassen – keine Namen, Lizenz- oder
              Kontaktdaten.
            </ValidationHint>
            {pilotEditorId !== "new" ? (
              <dl className="master-editor-readonly-summary">
                <div><dt>Pausenstatus</dt><dd>{currentPilot?.paused ? "Pause" : "Einsatzbereit"}</dd></div>
                <div>
                  <dt>Aktuelle Fluggruppe</dt>
                  <dd>
                    {currentPilot?.currentCommunicationNumber
                      ? `Fluggruppe ${currentPilot.currentCommunicationNumber}`
                      : "Nicht zugeordnet"}
                  </dd>
                </div>
              </dl>
            ) : null}
            {masterSubmitAttempted && !/^[A-Z0-9-]{2,12}$/.test(pilotCode) ? (
              <ValidationHint tone="error">
                Der Pilotencode muss aus 2 bis 12 Großbuchstaben, Ziffern oder Bindestrichen
                bestehen.
              </ValidationHint>
            ) : null}
            {pilotEditorId !== "new" ? (
              <section className="master-editor-status-section">
                <div>
                  <h3>Status</h3>
                  <p>
                    Der Pilotencode ist aktuell {currentPilot?.active ? "aktiv" : "inaktiv"}.
                    Statusänderungen werden separat gespeichert und protokolliert.
                    {masterEditorDirty
                      ? " Speichern oder verwerfen Sie zuerst die Formularänderungen."
                      : ""}
                  </p>
                </div>
                <Button
                  busy={busyActionKey === "master-pilot-toggle"}
                  disabled={!isAdministrator || masterEditorDirty}
                  onClick={() => requestMasterSave("pilot-toggle", true)}
                  type="button"
                >
                  {currentPilot?.active ? "Deaktivieren" : "Aktivieren"}
                </Button>
              </section>
            ) : null}
            {masterEditorMobileFurtherActions}
          </ModalDialog>
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
          <section
            className="admin-section admin-simulator-launch"
            hidden={adminArea !== "evaluation"}
          >
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
                  Stammdaten und offene Planeinträge als lokale Simulationsgrundlage verwenden.
                  Tickets, Ist-Verläufe und operative Zustände werden nicht exportiert.
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
          {adminArea === "events" && eventStep === "operations" && board ? (
            <section
              aria-labelledby="admin-event-step-operations-tab"
              id="admin-event-step-operations-panel"
              role="tabpanel"
            >
              <OperationsWorkspace
                board={board}
                plan={
                  <>
                    <Panel className="event-release-v15" padding="compact">
                      <PageHeader
                        actions={
                          <StatusPill tone={eventIsReleased || setupComplete ? "success" : "warning"}>
                            {eventIsReleased ? "Freigegeben" : `${completedSetupSteps}/6 erledigt`}
                          </StatusPill>
                        }
                        level={2}
                        title="Betriebsfreigabe"
                      />
                      {eventIsReleased ? (
                        <>
                          <p className="event-release-ready">
                            <CheckCircle2 aria-hidden="true" />{" "}
                            {board.event.status === "ACTIVE"
                              ? "Der Veranstaltungsbetrieb ist freigegeben."
                              : "Der Veranstaltungsbetrieb ist geschlossen."}
                          </p>
                          {board.event.status === "ACTIVE" ? (
                            <div className="event-release-action">
                              <Button
                                disabled={!isAdministrator}
                                onClick={() => setEndOperationsConfirmOpen(true)}
                                variant="danger"
                              >
                                Betrieb beenden
                              </Button>
                            </div>
                          ) : null}
                        </>
                      ) : !setupComplete ? (
                        <>
                          <p>
                            Die Veranstaltung ist noch nicht betriebsbereit. Bitte erledige die
                            offenen Punkte, um den Betrieb freizugeben.
                          </p>
                          <ul className="event-release-missing">
                            {setupSteps
                              .filter((step) => !step.complete)
                              .map((step) => (
                                <li key={step.id}>
                                  <Clock3 aria-hidden="true" />
                                  <Button onClick={() => openSetupStep(step)} size="compact" variant="ghost">
                                    {step.label} fehlt
                                  </Button>
                                </li>
                              ))}
                          </ul>
                        </>
                      ) : (
                        <p className="event-release-ready">
                          <CheckCircle2 aria-hidden="true" /> Alle Einrichtungsschritte sind abgeschlossen.
                        </p>
                      )}
                      {!eventIsReleased ? (
                        <div className="event-release-action">
                          <Button
                            disabled={!isAdministrator || !setupComplete}
                            onClick={() => requestAdminAction(() => setEventLifecycle("ACTIVE"))}
                            variant="primary"
                          >
                            <LockKeyhole aria-hidden="true" /> Betrieb freigeben
                          </Button>
                        </div>
                      ) : null}
                    </Panel>
                    <section className="admin-section admin-operational-plan-section">
                      <OperationalPlanPanel
                        aircraft={board.aircraft}
                        busy={busyActionKey !== null}
                        eventId={board.event.eventId}
                        eventTimeZone={board.event.timeZone}
                        mode="admin"
                        onCancel={(plan) =>
                          runBusyAction("admin-plan-cancel", () => cancelAdminPlannedOperation(plan))
                        }
                        onDisableRecurringRule={(rule) =>
                          runBusyAction("admin-rule-disable", () => disableAdminRecurringRule(rule))
                        }
                        onUpsert={(payload) =>
                          runBusyAction("admin-plan-upsert", () => upsertAdminPlannedOperation(payload))
                        }
                        onUpsertRecurringRule={(payload) =>
                          runBusyAction("admin-rule-upsert", () => upsertAdminRecurringRule(payload))
                        }
                        pilots={board.pilots}
                        plannedOperations={board.plannedOperations}
                        recurringOperationalRules={board.recurringOperationalRules}
                        readOnly={!isAdministrator || !adminModeUnlocked}
                        resourceGroups={board.resourceGroups}
                        rotations={board.rotations}
                      />
                    </section>
                  </>
                }
                sales={
                  <section className="admin-section admin-capacity-section">
                    <div className="section-heading">
                      <div>
                        <h2>Verkauf und Kapazität</h2>
                        <p>Produktbezogene Freigabe, Restplätze, Empfehlung und Verkaufsschluss.</p>
                      </div>
                    </div>
                    <div className="capacity-overview">
                      {alphabeticalProducts.map((product) => (
                        <div className="capacity-row" key={product.id}>
                          <div>
                            <strong>{product.name}</strong>
                            <span>{product.saleEnabled ? "Verkauf aktiv" : "Verkauf gesperrt"}</span>
                          </div>
                          <div>
                            <strong>{product.remainingSellableSeats}</strong>
                            <span>{capacityLabel[product.capacityStatus]}</span>
                          </div>
                          <div>
                            <strong>
                              {product.saleRecommended ? "Verkauf empfohlen" : "Nicht verkaufen"}
                            </strong>
                            <span>Prognose {predictionQualityLabel[product.predictionQuality]}</span>
                          </div>
                          <div>
                            <strong>
                              {product.saleClosesAt
                                ? formatEventLocalDateTime(product.saleClosesAt, board.event.timeZone)
                                : "Nicht gesetzt"}
                            </strong>
                            <span>Verkaufsschluss</span>
                          </div>
                          <div className="secondary-actions">
                            <Button
                              busy={busyActionKey === `product-${product.id}-sales`}
                              disabled={!isAdministrator || busyActionKey !== null}
                              onClick={() =>
                                requestAdminAction(() =>
                                  runBusyAction(`product-${product.id}-sales`, () =>
                                    configureProductSales(product, !product.saleEnabled),
                                  ),
                                )
                              }
                              type="button"
                            >
                              {product.saleEnabled ? "Verkauf sperren" : "Verkauf freigeben"}
                            </Button>
                            <Button
                              disabled={!isAdministrator || busyActionKey !== null}
                              onClick={() => {
                                setSalesClosingProductId(product.id);
                                setSaleClosesAt(
                                  product.saleClosesAt
                                    ? formatEventLocalDateTime(
                                        product.saleClosesAt,
                                        board.event.timeZone,
                                      )
                                    : "",
                                );
                              }}
                              type="button"
                            >
                              Verkaufsschluss bearbeiten
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                }
                exceptions={
                  <section className="admin-section admin-emergency-section">
                    <h2>Notfallmodus</h2>
                    <p>
                      Aktivierung und Aufhebung werden getrennt bestätigt. Versteckte Flotten-,
                      Piloten-, Queue- und Hinweissteuerungen gehören nicht zu diesem Admin-Ablauf.
                    </p>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="emergency-reason"
                        label="Begründung für den Notfallmodus"
                        help="Mindestens drei Zeichen; der Grund wird mit der Zustandsänderung protokolliert."
                      />
                      <input
                        id="emergency-reason"
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Mindestens 3 Zeichen"
                        value={reason}
                      />
                    </div>
                    <Button
                      busy={busyActionKey === (board.event.emergencyMode ? "emergency-clear" : "emergency-trigger")}
                      className="danger-action"
                      disabled={
                        reason.trim().length < 3 ||
                        busyActionKey !== null ||
                        (board.event.emergencyMode && !isAdministrator)
                      }
                      onClick={() =>
                        setPendingEmergencyAction(
                          board.event.emergencyMode ? "CLEAR_EMERGENCY" : "TRIGGER_EMERGENCY",
                        )
                      }
                      type="button"
                      variant="danger"
                    >
                      {board.event.emergencyMode ? "Notfallmodus aufheben" : "Not-Halt auslösen"}
                    </Button>
                  </section>
                }
              />
              <ProductSalesClosingDialog
                busy={
                  salesClosingProductId !== null &&
                  busyActionKey === `product-${salesClosingProductId}-closing`
                }
                onChange={setSaleClosesAt}
                onClose={() => setSalesClosingProductId(null)}
                onSave={(remove) => {
                  const product = board.products.find(
                    (entry) => entry.id === salesClosingProductId,
                  );
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
                product={
                  board.products.find((product) => product.id === salesClosingProductId) ?? null
                }
                value={saleClosesAt}
              />
              <ConfirmationDialog
                body={
                  <p>
                    Nach dem Betriebsende sind keine regulären operativen Änderungen mehr möglich.
                    Der Vorgang wird protokolliert.
                  </p>
                }
                confirmLabel="Betrieb jetzt beenden"
                danger
                onCancel={() => setEndOperationsConfirmOpen(false)}
                onConfirm={() => {
                  setEndOperationsConfirmOpen(false);
                  return requestAdminAction(() => setEventLifecycle("CLOSED"));
                }}
                open={endOperationsConfirmOpen}
                title="Betrieb wirklich beenden?"
              />
              <ConfirmationDialog
                body={
                  <p>
                    {pendingEmergencyAction === "CLEAR_EMERGENCY"
                      ? "Der Notfallmodus wird aufgehoben und die Aufhebung protokolliert."
                      : "Der Notfallmodus wird veranstaltungsweit aktiviert und protokolliert."}
                  </p>
                }
                confirmLabel={
                  pendingEmergencyAction === "CLEAR_EMERGENCY"
                    ? "Notfallmodus aufheben"
                    : "Not-Halt auslösen"
                }
                danger
                onCancel={() => setPendingEmergencyAction(null)}
                onConfirm={() => {
                  const action = pendingEmergencyAction;
                  setPendingEmergencyAction(null);
                  if (!action) return;
                  if (action === "CLEAR_EMERGENCY") {
                    return requestAdminAction(() =>
                      runBusyAction("emergency-clear", () => emergency(action)),
                    );
                  }
                  return runBusyAction("emergency-trigger", () => emergency(action));
                }}
                open={pendingEmergencyAction !== null}
                title={
                  pendingEmergencyAction === "CLEAR_EMERGENCY"
                    ? "Notfallmodus wirklich aufheben?"
                    : "Not-Halt wirklich auslösen?"
                }
              />
            </section>
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
                <section className="admin-section completion-day-summary">
                  <div className="section-heading">
                    <div>
                      <h2>Tagesübersicht</h2>
                      <p>Veranstaltungs-, Zeitraum- und Board-Kennzahlen des bestätigten Stands.</p>
                    </div>
                  </div>
                  <dl className="completion-summary-grid">
                    <div><dt>Betriebsbeginn</dt><dd>{formatEventLocalDateTime(board.event.operationsStartAt, board.event.timeZone) || "Nicht gestartet"}</dd></div>
                    <div><dt>Betriebsende</dt><dd>{formatEventLocalDateTime(board.event.operationsEndAt, board.event.timeZone) || "Nicht gesetzt"}</dd></div>
                    <div><dt>Abgeschlossene Umläufe</dt><dd>{board.metrics.completedRotations}</dd></div>
                    <div><dt>Offene Tickets</dt><dd>{board.metrics.openTickets}</dd></div>
                    <div><dt>Ø Umlaufzeit</dt><dd>{board.metrics.averageRotationMinutes ?? "–"} Min.</dd></div>
                    <div><dt>Informatorischer Umsatz</dt><dd>{(board.metrics.informationalRevenueCents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</dd></div>
                  </dl>
                  <div className="completion-primary-exports">
                    <Button
                      busy={busyActionKey === "export-daily-pdf"}
                      onClick={() => void runBusyAction("export-daily-pdf", exportDailyPdf)}
                      type="button"
                      variant="primary"
                    >
                      PDF-Tagesbericht
                    </Button>
                    <Button
                      busy={busyActionKey === "export-daily-csv"}
                      onClick={() => void runBusyAction("export-daily-csv", exportDailyReport)}
                      type="button"
                    >
                      CSV-Tagesbericht
                    </Button>
                  </div>
                  <details className="completion-secondary-exports">
                    <summary>Weitere Datenexporte</summary>
                    <div>
                      <Button
                        busy={busyActionKey === "export-raw-data"}
                        onClick={() => void runBusyAction("export-raw-data", exportRawData)}
                        type="button"
                      >
                        Ticket-Rohdaten CSV
                      </Button>
                      <Button
                        busy={busyActionKey === "export-performance"}
                        onClick={() => void runBusyAction("export-performance", exportPerformanceProfile)}
                        type="button"
                      >
                        Leistungsprofil JSON
                      </Button>
                    </div>
                  </details>
                </section>
              }
              history={
                <section className="admin-section completion-history-panel">
            <fieldset className="history-filters">
              <legend>
                {historyView === "OPERATIONS"
                  ? "Betriebsdaten filtern"
                  : historyView === "FORECASTS"
                    ? "Prognosen filtern"
                    : "Audit-Ereignisse filtern"}
              </legend>
              <div className="history-visible-filters">
                <LocalizedDateTimeInput
                  label="Von"
                  labelContent={<FieldGroupLabel label="Von" help="Optionaler Beginn des ausgewerteten Zeitraums." />}
                  onChange={setHistorySince}
                  value={historySince}
                />
                <LocalizedDateTimeInput
                  label="Bis"
                  labelContent={<FieldGroupLabel label="Bis" help="Optionales Ende des ausgewerteten Zeitraums." />}
                  onChange={setHistoryUntil}
                  value={historyUntil}
                />
                {historyView === "OPERATIONS" ? (
                  <div className="field-control">
                    <FieldLabel
                      htmlFor="history-communication-number"
                      label="Fluggruppennummer"
                      help="Stabile Kommunikationsnummer, keine garantierte Uhrzeit."
                    />
                    <input
                      id="history-communication-number"
                      min="1"
                      onChange={(event) => setHistoryCommunicationNumber(event.target.value)}
                      type="number"
                      value={historyCommunicationNumber}
                    />
                  </div>
                ) : null}
                {historyView === "FORECASTS" ? (
                  <div className="field-control">
                    <FieldLabel htmlFor="history-aircraft" label="Flugzeug" help="Begrenzt Prognosen auf ein Flugzeug." />
                    <select id="history-aircraft" onChange={(event) => setHistoryAircraftId(event.target.value)} value={historyAircraftId}>
                      <option value="">Alle</option>
                      {board.aircraft.map((aircraft) => <option key={aircraft.id} value={aircraft.id}>{aircraft.registration}</option>)}
                    </select>
                  </div>
                ) : null}
                {historyView === "AUDIT" ? (
                  <div className="field-control history-readable-search">
                    <FieldLabel
                      htmlFor="history-readable-search"
                      label="Ereignis oder Objekt suchen"
                      help="Durchsucht lesbare Ereignis- und Objekttexte; unbekannte technische Typen bleiben auffindbar."
                    />
                    <input
                      id="history-readable-search"
                      onChange={(event) => setHistoryTextSearch(event.target.value)}
                      placeholder="z. B. Fluggruppe aufgerufen"
                      type="search"
                      value={historyTextSearch}
                    />
                  </div>
                ) : null}
              </div>
              {historyView === "OPERATIONS" ? (
                <>
                  <details className="history-advanced-filters">
                    <summary>Fachliche Filter</summary>
                    <div>
                      <div className="field-control">
                        <FieldLabel htmlFor="history-aircraft" label="Flugzeug" help="Begrenzt die Betriebshistorie auf ein Flugzeug." />
                        <select id="history-aircraft" onChange={(event) => setHistoryAircraftId(event.target.value)} value={historyAircraftId}>
                          <option value="">Alle</option>
                          {board.aircraft.map((aircraft) => <option key={aircraft.id} value={aircraft.id}>{aircraft.registration}</option>)}
                        </select>
                      </div>
                      <div className="field-control">
                        <FieldLabel htmlFor="history-pilot" label="Pilotencode" help="Anonymer operativer Pilotencode." />
                        <select id="history-pilot" onChange={(event) => setHistoryPilotId(event.target.value)} value={historyPilotId}>
                          <option value="">Alle</option>
                          {board.pilots.map((pilot) => <option key={pilot.id} value={pilot.id}>{pilot.operationalCode}</option>)}
                        </select>
                      </div>
                      <div className="field-control">
                        <FieldLabel htmlFor="history-product" label="Produkt" help="Begrenzt die Betriebshistorie auf ein Produkt." />
                        <select id="history-product" onChange={(event) => setHistoryProductId(event.target.value)} value={historyProductId}>
                          <option value="">Alle</option>
                          {alphabeticalProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                        </select>
                      </div>
                      <div className="field-control">
                        <FieldLabel htmlFor="history-resource-group" label="Ressourcengruppe" help="Begrenzt die Historie auf eine operative Queue." />
                        <select id="history-resource-group" onChange={(event) => setHistoryResourceGroupId(event.target.value)} value={historyResourceGroupId}>
                          <option value="">Alle</option>
                          {board.resourceGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                        </select>
                      </div>
                      <div className="field-control">
                        <FieldLabel htmlFor="history-ticket-status" label="Ticketstatus" help="Lesbarer Status des anonymen Tickets." />
                        <select id="history-ticket-status" onChange={(event) => setHistoryTicketStatus(event.target.value)} value={historyTicketStatus}>
                          <option value="">Alle</option>
                          {Object.entries(historyTicketStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
                        </select>
                      </div>
                    </div>
                  </details>
                  <details className="history-technical-filters">
                    <summary>Technische Filter</summary>
                    <div>
                      <Field label="Umlauf-ID"><input onChange={(event) => setHistoryRotationId(event.target.value)} value={historyRotationId} /></Field>
                      <Field label="Ticket-ID"><input onChange={(event) => setHistoryTicketId(event.target.value)} value={historyTicketId} /></Field>
                      <Field label="Ticketgruppen-ID"><input onChange={(event) => setHistoryTicketGroupId(event.target.value)} value={historyTicketGroupId} /></Field>
                    </div>
                  </details>
                </>
              ) : null}
              {historyView === "FORECASTS" ? (
                <>
                  <details className="history-advanced-filters">
                    <summary>Weitere fachliche Filter</summary>
                    <div>
                      <div className="field-control">
                        <FieldLabel htmlFor="history-pilot" label="Pilotencode" help="Anonymer operativer Pilotencode." />
                        <select id="history-pilot" onChange={(event) => setHistoryPilotId(event.target.value)} value={historyPilotId}>
                          <option value="">Alle</option>
                          {board.pilots.map((pilot) => <option key={pilot.id} value={pilot.id}>{pilot.operationalCode}</option>)}
                        </select>
                      </div>
                    </div>
                  </details>
                  <details className="history-technical-filters">
                    <summary>Technische Filter</summary>
                    <div><Field label="Umlauf-ID"><input onChange={(event) => setHistoryRotationId(event.target.value)} value={historyRotationId} /></Field></div>
                  </details>
                </>
              ) : null}
              {historyView === "AUDIT" ? (
                <details className="history-technical-filters">
                  <summary>Technische Serverfilter</summary>
                  <div>
                    <Field label="Ereignistyp"><input onChange={(event) => setHistoryEventType(event.target.value)} value={historyEventType} /></Field>
                    <Field label="Aggregate-Typ"><input onChange={(event) => setHistoryAggregateType(event.target.value)} value={historyAggregateType} /></Field>
                    <Field label="Aggregate-ID"><input onChange={(event) => setHistoryAggregateId(event.target.value)} value={historyAggregateId} /></Field>
                  </div>
                </details>
              ) : null}
              <nav className="history-filter-chips" aria-label="Aktive Filter">
                {historySince ? <button onClick={() => { setHistorySince(""); setHistoryOffset(0); }} type="button">Von entfernen</button> : null}
                {historyUntil ? <button onClick={() => { setHistoryUntil(""); setHistoryOffset(0); }} type="button">Bis entfernen</button> : null}
                {historyCommunicationNumber ? <button onClick={() => { setHistoryCommunicationNumber(""); setHistoryOffset(0); }} type="button">Fluggruppe entfernen</button> : null}
                {historyAircraftId ? <button onClick={() => { setHistoryAircraftId(""); setHistoryOffset(0); }} type="button">Flugzeug entfernen</button> : null}
                {historyPilotId ? <button onClick={() => { setHistoryPilotId(""); setHistoryOffset(0); }} type="button">Pilotencode entfernen</button> : null}
                {historyTextSearch ? <button onClick={() => { setHistoryTextSearch(""); setHistoryOffset(0); }} type="button">Suche entfernen</button> : null}
              </nav>
              <div className="history-filter-actions">
                <Button
                  onClick={() => {
                    setHistoryOffset(0);
                    if (historyView === "AUDIT") void refreshHistory();
                    else void refreshDetailedHistory(0);
                  }}
                  type="button"
                  variant="primary"
                >
                  Anwenden
                </Button>
                <Button onClick={resetHistoryFilters} type="button">Zurücksetzen</Button>
              </div>
            </fieldset>
            {historyView === "OPERATIONS" ? (
              <div className="history-table-wrap">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Zeitpunkt</th>
                      <th>Fluggruppe</th>
                      <th>Ticket / Gruppe</th>
                      <th>Status</th>
                      <th>Flugzeug</th>
                      <th>Pilot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operationalHistory.entries.map((entry) => (
                      <tr key={`${entry.ticketId}-${entry.rotationId ?? "open"}`}>
                        <td>
                          {new Date(entry.latestAt).toLocaleString("de-DE", {
                            timeZone: board?.event.timeZone ?? "Europe/Berlin",
                          })}
                        </td>
                        <td>{entry.communicationLabel ?? "Noch offen"}</td>
                        <td>
                          Anonymes Ticket
                          <details className="history-row-details">
                            <summary>Technische Details</summary>
                            <code>{entry.ticketId}</code>
                            <code>{entry.ticketGroupId}</code>
                            {entry.rotationId ? <code>{entry.rotationId}</code> : null}
                          </details>
                        </td>
                        <td>{historyTicketStatusLabels[entry.ticketStatus] ?? entry.ticketStatus}</td>
                        <td>{entry.aircraftRegistration ?? "–"}</td>
                        <td>{entry.pilotOperationalCode ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {operationalHistory.entries.length === 0 ? (
                  <p>Keine passenden Betriebsdaten.</p>
                ) : null}
              </div>
            ) : historyView === "FORECASTS" ? (
              <div className="history-table-wrap">
                <table className="history-table forecast-history-table">
                  <thead>
                    <tr>
                      <th>Snapshot</th>
                      <th>Fluggruppe</th>
                      <th>Auslöser</th>
                      <th>Qualität / Grundlage</th>
                      <th>Abweichungen in Minuten</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecastHistory.entries.map((entry) => (
                      <tr key={entry.snapshotId}>
                        <td>
                          {new Date(entry.capturedAt).toLocaleString("de-DE", {
                            timeZone: board?.event.timeZone ?? "Europe/Berlin",
                          })}
                        </td>
                        <td>
                          {entry.communicationLabel}
                          <details className="history-row-details">
                            <summary>Technische Details</summary>
                            <code>{entry.rotationId}</code>
                            <code>{entry.snapshotId}</code>
                          </details>
                        </td>
                        <td>{historyEventLabels[entry.triggerEventType] ?? entry.triggerEventType}</td>
                        <td>
                          {entry.quality}
                          <small>
                            {entry.dataBasisScope} · n={entry.sampleSize} · Alter{" "}
                            {Math.round(entry.dataAgeMinutes)} Min.
                          </small>
                        </td>
                        <td>
                          <span>Boarding {entry.deviationMinutes.boarding ?? "–"}</span>
                          <span>Start {entry.deviationMinutes.departure ?? "–"}</span>
                          <span>Landung {entry.deviationMinutes.landing ?? "–"}</span>
                          <span>Abschluss {entry.deviationMinutes.completion ?? "–"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {forecastHistory.entries.length === 0 ? (
                  <p>Keine passenden Prognosesnapshots.</p>
                ) : null}
              </div>
            ) : (
              <div className="audit-list">
                {history.entries
                  .filter((entry) =>
                    `${historyEventLabels[entry.eventType] ?? entry.eventType} ${entry.eventType} ${entry.aggregateType}`
                      .toLocaleLowerCase("de-DE")
                      .includes(historyTextSearch.trim().toLocaleLowerCase("de-DE")),
                  )
                  .slice(0, 50)
                  .map((entry) => (
                  <div key={entry.sequence}>
                    <time dateTime={entry.occurredAt}>
                      {new Date(entry.occurredAt).toLocaleString("de-DE", {
                        timeZone: board?.event.timeZone ?? "Europe/Berlin",
                      })}
                    </time>
                    <strong>{historyEventLabels[entry.eventType] ?? entry.eventType}</strong>
                    {historyEventLabels[entry.eventType] ? <small>{entry.eventType}</small> : null}
                    <details className="history-row-details">
                      <summary>Technische Details</summary>
                      <span>{entry.aggregateType} · Version {entry.aggregateVersion}</span>
                      <code>{entry.aggregateId}</code>
                    </details>
                  </div>
                ))}
                {history.entries.length === 0 ? <p>Keine passenden Ereignisse.</p> : null}
              </div>
            )}
            {historyView !== "AUDIT" ? (
              <div className="history-pagination">
                <Button
                  busy={busyActionKey === "history-previous"}
                  disabled={historyOffset === 0 || busyActionKey !== null}
                  onClick={() =>
                    runBusyAction("history-previous", () =>
                      refreshDetailedHistory(Math.max(0, historyOffset - 50)),
                    )
                  }
                  type="button"
                >
                  Zurück
                </Button>
                <span>
                  {historyOffset + 1}–
                  {Math.min(
                    historyOffset + 50,
                    historyView === "OPERATIONS" ? operationalHistory.total : forecastHistory.total,
                  )}{" "}
                  von{" "}
                  {historyView === "OPERATIONS" ? operationalHistory.total : forecastHistory.total}
                </span>
                <Button
                  busy={busyActionKey === "history-next"}
                  disabled={
                    busyActionKey !== null ||
                    historyOffset + 50 >=
                      (historyView === "OPERATIONS"
                        ? operationalHistory.total
                        : forecastHistory.total)
                  }
                  onClick={() =>
                    runBusyAction("history-next", () => refreshDetailedHistory(historyOffset + 50))
                  }
                  type="button"
                >
                  Weiter
                </Button>
              </div>
            ) : null}
                </section>
              }
              corrections={
                <section className="admin-section manifest-correction">
                  <div className="section-heading">
                    <div>
                      <h2>Dokumentierte Besetzung korrigieren</h2>
                      <p>
                        Eine anonyme Buchungsgruppe wird immer vollständig einem bereits gestarteten
                        oder abgeschlossenen Umlauf zugeordnet.
                      </p>
                    </div>
                    <span className="admin-only-badge">Nur Administration</span>
                  </div>
                  <ValidationHint>
                    Diese Korrektur berichtigt ausschließlich die Dokumentation und besitzt keine
                    flugbetriebliche oder sicherheitsbezogene Freigabewirkung.
                  </ValidationHint>
                  <div className="manifest-correction-grid">
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="manifest-ticket-group"
                        label="Zu korrigierende Buchungsgruppe"
                        help="Nur anonyme Gruppen mit bereits gestartetem oder abgeschlossenem dokumentiertem Umlauf."
                      />
                      <select
                        id="manifest-ticket-group"
                        onChange={(event) => {
                          setManifestTicketGroupId(event.target.value);
                          setManifestTargetRotationId("");
                        }}
                        value={manifestTicketGroupId}
                      >
                        <option value="">Bitte wählen</option>
                        {manifestCandidates.map((candidate) => (
                          <option key={candidate.ticketGroupId} value={candidate.ticketGroupId}>
                            {candidate.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-control">
                      <FieldLabel
                        htmlFor="manifest-target-rotation"
                        label="Tatsächlicher Zielumlauf"
                        help="Der Zielumlauf muss mindestens den Status Im Flug erreicht haben."
                      />
                      <select
                        disabled={!selectedManifestCandidate}
                        id="manifest-target-rotation"
                        onChange={(event) => setManifestTargetRotationId(event.target.value)}
                        value={manifestTargetRotationId}
                      >
                        <option value="">Bitte wählen</option>
                        {manifestTargets.map((rotation) => (
                          <option key={rotation.id} value={rotation.id}>
                            {rotation.communicationLabel} · {rotationStatusLabel[rotation.status]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field-control manifest-reason-field">
                      <FieldLabel
                        htmlFor="manifest-correction-reason"
                        label="Dokumentationsgrund"
                        help="Mindestens 10 Zeichen; Grund, Quelle, Ziel, Gerät und Version werden auditiert."
                      />
                      <textarea
                        id="manifest-correction-reason"
                        maxLength={500}
                        onChange={(event) => setManifestCorrectionReason(event.target.value)}
                        placeholder="Tatsächliche Besetzung nach Rückmeldung berichtigen"
                        value={manifestCorrectionReason}
                      />
                      <small>{manifestCorrectionReason.trim().length}/10 Mindestzeichen</small>
                    </div>
                  </div>
                  {selectedManifestCandidate ? (
                    <div className="manifest-correction-preview">
                      <div><span>Bisher dokumentiert</span><strong>{selectedManifestCandidate.label}</strong></div>
                      <span aria-hidden="true">→</span>
                      <div>
                        <span>Wird vollständig zugeordnet zu</span>
                        <strong>
                          {manifestTargets.find((rotation) => rotation.id === manifestTargetRotationId)
                            ?.communicationLabel ?? "Zielumlauf wählen"}
                        </strong>
                      </div>
                    </div>
                  ) : null}
                  <Button
                    busy={busyActionKey === "manifest-correction"}
                    className="primary-action manifest-correction-action"
                    disabled={
                      busyActionKey !== null ||
                      !isAdministrator ||
                      !manifestTicketGroupId ||
                      !manifestTargetRotationId ||
                      manifestCorrectionReason.trim().length < 10
                    }
                    onClick={() =>
                      requestAdminAction(() =>
                        runBusyAction("manifest-correction", correctRotationManifest),
                      )
                    }
                    type="button"
                    variant="primary"
                  >
                    Besetzung protokolliert korrigieren
                  </Button>
                  {manifestCandidates.length === 0 ? (
                    <p className="help-text">Aktuell ist keine Korrektur nach Flugstart erforderlich.</p>
                  ) : null}
                </section>
              }
            />
            </section>
          ) : null}
          {adminPinDialog ? (
            <ModalDialog
              description={
                adminPinDialog === "unlock"
                  ? "Die PIN gilt nur in diesem Browser-Tab und wird nach 15 Minuten Inaktivität verworfen."
                  : "Diese einzelne Änderung wird nach erfolgreicher PIN-Prüfung ausgeführt und protokolliert."
              }
              footer={
                <>
                  <Button
                    disabled={adminPinBusy}
                    onClick={closeAdminPinDialog}
                    type="button"
                  >
                    Abbrechen
                  </Button>
                  <Button
                    busy={adminPinBusy}
                    disabled={adminPin.length < 4}
                    form="admin-pin-form"
                    type="submit"
                    variant="primary"
                  >
                    {adminPinDialog === "unlock" ? "Entsperren" : "Bestätigen"}
                  </Button>
                </>
              }
              initialFocusSelector="#admin-pin-input"
              onClose={() => {
                if (!adminPinBusy) closeAdminPinDialog();
              }}
              open
              size="compact"
              title={
                adminPinDialog === "unlock"
                  ? "Bearbeitungsmodus entsperren"
                  : "Änderung bestätigen"
              }
            >
              <form
                className="admin-pin-form"
                id="admin-pin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmAdminPinDialog();
                }}
              >
                <div className="ds-field admin-pin-field">
                  <label htmlFor="admin-pin-input">Administrator-PIN</label>
                  <input
                    autoComplete="current-password"
                    id="admin-pin-input"
                    onChange={(event) => setAdminPin(event.target.value)}
                    ref={adminPinInputRef}
                    type="password"
                    value={adminPin}
                  />
                </div>
                {adminPinError ? (
                  <ValidationHint tone="error">{adminPinError}</ValidationHint>
                ) : null}
              </form>
            </ModalDialog>
          ) : null}
          {pendingMasterDelete ? (
            <ModalDialog
              bodyClassName="master-delete-dialog-body"
              className="master-delete-dialog"
              closeLabel="Löschen abbrechen"
              description="Diese Aktion entfernt den Datensatz dauerhaft und wird dem angemeldeten Konto zugeordnet und protokolliert."
              footer={
                <>
                  <Button data-master-delete-cancel onClick={cancelMasterDelete} type="button">
                    Abbrechen
                  </Button>
                  <Button
                    busy={busyActionKey === "master-delete"}
                    disabled={
                      board?.event.status !== "PREPARATION" ||
                      pendingMasterDelete.blockers.length > 0 ||
                      adminPin.length < 4
                    }
                    onClick={() => void runBusyAction("master-delete", confirmMasterDelete)}
                    type="button"
                    variant="danger"
                  >
                    Endgültig löschen
                  </Button>
                </>
              }
              initialFocusSelector="[data-master-delete-cancel]"
              onClose={cancelMasterDelete}
              open
              role="alertdialog"
              size="default"
              title={
                <span className="master-delete-title">
                  <Trash2 aria-hidden="true" />
                  {pendingMasterDelete.label} endgültig löschen?
                </span>
              }
            >
              <div className="master-delete-record">
                <strong>{pendingMasterDelete.label}</strong>
                <span>Administrativer Stammdatensatz</span>
              </div>
              <section aria-labelledby="master-delete-effects">
                <h3 id="master-delete-effects">Auswirkungen</h3>
                {board?.event.status !== "PREPARATION" ? (
                  <div className="delete-blockers" role="status">
                    <strong>Löschen ist nach Betriebsfreigabe gesperrt.</strong>
                    <span>Stammdaten können jetzt nur noch deaktiviert werden.</span>
                  </div>
                ) : pendingMasterDelete.blockers.length > 0 ? (
                  <div className="delete-blockers" role="status">
                    <strong>Löschen noch nicht möglich</strong>
                    <span>Zuerst entfernen:</span>
                    <ul>
                      {pendingMasterDelete.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="delete-ready-copy">
                    <CheckCircle2 aria-hidden="true" />
                    <span>
                      Keine erkennbaren Abhängigkeiten. Der Server prüft sie vor dem Löschen erneut.
                    </span>
                  </div>
                )}
              </section>
              {!adminModeUnlocked ? (
                <div className="ds-field master-delete-pin-field">
                  <label htmlFor="master-delete-pin">Administrator-PIN</label>
                  <input
                    autoComplete="current-password"
                    id="master-delete-pin"
                    onChange={(event) => setAdminPin(event.target.value)}
                    ref={adminPinInputRef}
                    type="password"
                    value={adminPin}
                  />
                </div>
              ) : (
                <ValidationHint>
                  Der Entwurf bleibt erhalten. Zum Löschen ist weiterhin diese ausdrückliche
                  Bestätigung erforderlich.
                </ValidationHint>
              )}
              <p className="master-delete-audit-note">
                Einheitlicher Audit-Grund: Administrative Stammdatenlöschung
              </p>
            </ModalDialog>
          ) : null}
          <ModalDialog
            description="Versionierte Stammdaten werden geprüft und ausschließlich atomar in eine leere Veranstaltung in Vorbereitung importiert."
            footer={
              <>
                <Button
                  disabled={templateBusy}
                  onClick={() => setTemplateDialogOpen(false)}
                  type="button"
                >
                  Abbrechen
                </Button>
                <Button
                  busy={templateBusy}
                  disabled={
                    !templateDraft ||
                    !templateValidation?.valid ||
                    !templateValidation.targetEligible
                  }
                  onClick={() => void applyMasterDataTemplate()}
                  type="button"
                  variant="primary"
                >
                  Importieren
                </Button>
              </>
            }
            onClose={() => {
              if (!templateBusy) setTemplateDialogOpen(false);
            }}
            open={templateDialogOpen}
            size="wide"
            title="Stammdatenvorlage importieren"
          >
            <div className="template-import-dialog">
              <Field
                help="JSON-Datei im Format rundflug-master-data-template, Version 1, höchstens 1 MiB."
                label="Vorlagendatei"
              >
                <input
                  accept="application/json,.json"
                  disabled={templateBusy}
                  onChange={(event) => void readMasterDataTemplate(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </Field>
              {templateFileName ? <p className="help-text">{templateFileName}</p> : null}
              {templateBusy ? <p role="status">Vorlage wird geprüft …</p> : null}
              {templateError ? <ValidationHint tone="error">{templateError}</ValidationHint> : null}
              {templateValidation ? (
                <>
                  <div className="template-counts">
                    <span className="visually-hidden">Inhalt der Vorlage:</span>
                    <span>
                      <strong>{templateValidation.counts.gates}</strong> Gates
                    </span>
                    <span>
                      <strong>{templateValidation.counts.resourceGroups}</strong> Gruppen
                    </span>
                    <span>
                      <strong>{templateValidation.counts.aircraft}</strong> Flugzeuge
                    </span>
                    <span>
                      <strong>{templateValidation.counts.assignments}</strong> Zuordnungen
                    </span>
                    <span>
                      <strong>{templateValidation.counts.pilots}</strong> Pilotencodes
                    </span>
                    <span>
                      <strong>{templateValidation.counts.products}</strong> Produkte
                    </span>
                  </div>
                  {!templateValidation.targetEligible ? (
                    <ValidationHint tone="error">
                      Das Ziel muss leer und im Status Vorbereitung sein. Vorhandene Stammdaten
                      werden weder zusammengeführt noch ersetzt.
                    </ValidationHint>
                  ) : null}
                  {templateValidation.errors.map((entry) => (
                    <ValidationHint key={`${entry.path}-${entry.message}`} tone="error">
                      {entry.path}: {entry.message}
                    </ValidationHint>
                  ))}
                  {templateValidation.warnings.map((warning) => (
                    <ValidationHint key={warning} tone="warning">
                      {warning}
                    </ValidationHint>
                  ))}
                  {templateValidation.valid && templateValidation.targetEligible ? (
                    <ValidationHint>
                      Die Vorlage ist gültig. Der Import erzeugt neue veranstaltungsbezogene
                      Kennungen und genau einen auditierten Versionssprung.
                    </ValidationHint>
                  ) : null}
                </>
              ) : null}
            </div>
          </ModalDialog>
          <ConfirmationDialog
            body={
              <p>
                Die ungespeicherten Veranstaltungsparameter gehen beim Verlassen dieser Ansicht
                verloren.
              </p>
            }
            confirmLabel="Verwerfen und wechseln"
            danger
            onCancel={() => {
              pendingEventNavigationRef.current = null;
              setDiscardEventNavigationOpen(false);
            }}
            onConfirm={() => {
              const action = pendingEventNavigationRef.current;
              pendingEventNavigationRef.current = null;
              setDiscardEventNavigationOpen(false);
              setEventParametersDirty(false);
              setEventParametersResetKey((current) => current + 1);
              action?.();
            }}
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
