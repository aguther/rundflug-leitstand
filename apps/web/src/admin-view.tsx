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
  cloneEvent,
  deleteEvent,
  downloadDailyPdf,
  downloadDailyReport,
  downloadMasterDataTemplate,
  downloadPerformanceProfile,
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
  Field,
  ModalDialog,
  PageHeader,
  Panel,
  SearchField,
  StatusPill,
  TextField,
} from "./design-system/components";
import { forgetActiveEvent, rememberActiveEvent } from "./event-context";
import { eventLocalDateTimeToIso, formatEventLocalDateTime } from "./event-time";
import { AdminEventFlowChart } from "./features/admin/AdminEventFlowChart";
import { EventLogoEditor } from "./features/admin/EventLogoEditor";
import { AccountManagement } from "./features/auth/AccountManagement";
import { useAuth } from "./features/auth/AuthContext";
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
import { formatEuroInput, parseEuroToCents, productPositionOptions } from "./product-editor";

const adminTableCollator = new Intl.Collator("de-DE", {
  numeric: true,
  sensitivity: "base",
});
const EMPTY_EVENT_LOGO_FILES: Record<EventLogoTheme, File | null> = {
  light: null,
  dark: null,
};
const NO_EVENT_LOGO_VARIANTS: Record<EventLogoTheme, boolean> = {
  light: false,
  dark: false,
};

function SortableTableHeading({
  active,
  direction,
  label,
  onClick,
}: {
  active: boolean;
  direction: "asc" | "desc" | null;
  label: string;
  onClick: () => void;
}) {
  return (
    <th
      aria-sort={active && direction ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button className="admin-sort-button" onClick={onClick} type="button">
        {label}
        <span aria-hidden="true">
          {active && direction ? (direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

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
    return (validSections as string[]).includes(requestedSection ?? "")
      ? (requestedSection as MasterDataCategory)
      : "resource-groups";
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing a filter or page size intentionally resets pagination
  useEffect(() => {
    setMasterPage(0);
  }, [masterDataCategory, masterSearch, masterPageSize]);
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
  const [pilotCode, setPilotCode] = useState("P-01");
  const [pilotNote, setPilotNote] = useState("");
  const [pilotEditorId, setPilotEditorId] = useState("new");
  const [refuelThreshold, setRefuelThreshold] = useState(5);
  const [operationalNotice, setOperationalNotice] = useState("");
  const [eventSettingsInitialized, setEventSettingsInitialized] = useState(false);
  const [saleOpensAt, setSaleOpensAt] = useState("");
  const [operationsEndAt, setOperationsEndAt] = useState("");
  const [noShowAfterMinutes, setNoShowAfterMinutes] = useState(10);
  const [maxTicketDeferrals, setMaxTicketDeferrals] = useState(2);
  const [notificationLeadMinutes, setNotificationLeadMinutes] = useState(15);
  const [automaticPrecallEnabled, setAutomaticPrecallEnabled] = useState(true);
  const [precallLeadMinutes, setPrecallLeadMinutes] = useState(15);
  const [maximumGateWaitMinutes, setMaximumGateWaitMinutes] = useState(20);
  const [precallMinimumQuality, setPrecallMinimumQuality] = useState<"STABLE" | "CHANGING">(
    "CHANGING",
  );
  const [precallGateCooldownMinutes, setPrecallGateCooldownMinutes] = useState(2);
  const [childReferenceWeightKg, setChildReferenceWeightKg] = useState(35);
  const [normalReferenceWeightKg, setNormalReferenceWeightKg] = useState(80);
  const [heavyReferenceWeightKg, setHeavyReferenceWeightKg] = useState(110);
  const [plannedBoardingMinutes, setPlannedBoardingMinutes] = useState(8);
  const [plannedDeboardingMinutes, setPlannedDeboardingMinutes] = useState(5);
  const [plannedBufferMinutes, setPlannedBufferMinutes] = useState(3);
  const [departedVisibilitySeconds, setDepartedVisibilitySeconds] = useState(15);
  const [eventLogoFiles, setEventLogoFiles] = useState<Record<EventLogoTheme, File | null>>(() => ({
    ...EMPTY_EVENT_LOGO_FILES,
  }));
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
  const [productEditorId, setProductEditorId] = useState("new");
  const [productName, setProductName] = useState("");
  const [productCode, setProductCode] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [productResourceGroupId, setProductResourceGroupId] = useState("");
  const [productGateId, setProductGateId] = useState("");
  const [productPriceInput, setProductPriceInput] = useState("0,00 €");
  const [productReferenceDuration, setProductReferenceDuration] = useState(20);
  const [productPromisedFlightMinutes, setProductPromisedFlightMinutes] = useState(20);
  const [productChildCompanion, setProductChildCompanion] = useState(false);
  const [productWeightClasses, setProductWeightClasses] = useState<string[]>(["NOT_CAPTURED"]);
  const [productSortOrder, setProductSortOrder] = useState(10);
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
  const [resourcePlannedMinutes, setResourcePlannedMinutes] = useState(30);
  const [resourceAutomaticPrecall, setResourceAutomaticPrecall] = useState(true);
  const [resourceAircraftIds, setResourceAircraftIds] = useState<string[]>([]);
  const [aircraftEditorId, setAircraftEditorId] = useState("new");
  const [aircraftRegistration, setAircraftRegistration] = useState("");
  const [aircraftType, setAircraftType] = useState("");
  const [aircraftSeats, setAircraftSeats] = useState(3);
  const [aircraftMaximumPayload, setAircraftMaximumPayload] = useState("");
  const [assignmentAircraftId, setAssignmentAircraftId] = useState("");
  const [assignmentResourceGroupId, setAssignmentResourceGroupId] = useState("");
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
            productChildCompanion,
            productWeightClasses,
            productSortOrder,
          ])
        : masterDataCategory === "resource-groups"
          ? createMasterEditorSnapshot([
              "resource-groups",
              resourceName,
              resourceShortCode,
              resourceGateId,
              resourcePlannedMinutes,
              resourceAutomaticPrecall,
              resourceAircraftIds,
            ])
          : masterDataCategory === "aircraft"
            ? createMasterEditorSnapshot([
                "aircraft",
                aircraftRegistration,
                aircraftType,
                aircraftSeats,
                aircraftMaximumPayload,
              ])
            : masterDataCategory === "assignments"
              ? createMasterEditorSnapshot([
                  "assignments",
                  assignmentAircraftId,
                  assignmentResourceGroupId,
                ])
              : createMasterEditorSnapshot(["pilots", pilotCode, pilotNote]);
  const masterEditorDirty =
    masterEditorOpen &&
    hasMasterEditorChanges(initialMasterEditorSnapshotRef.current, currentMasterEditorSnapshot);
  const [events, setEvents] = useState<EventCatalogEntry[]>([]);
  const [eventFlow, setEventFlow] = useState<AdminEventFlow | null>(null);
  const [eventFlowError, setEventFlowError] = useState<string | null>(null);
  const [eventFlowLoading, setEventFlowLoading] = useState(true);
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
  const [restartEditorOpen, setRestartEditorOpen] = useState(false);
  const [restartConfirmation, setRestartConfirmation] = useState("");
  const [factoryResetOpen, setFactoryResetOpen] = useState(false);
  const [factoryResetBusy, setFactoryResetBusy] = useState(false);
  const [factoryResetError, setFactoryResetError] = useState<string | null>(null);
  const [factoryResetReason, setFactoryResetReason] = useState("");
  const [factoryResetPin, setFactoryResetPin] = useState(
    session?.account.role === "ADMIN" ? "000000" : "",
  );
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
    setResourcePlannedMinutes(entry?.plannedRotationMinutes ?? 30);
    setResourceAutomaticPrecall(entry?.automaticPrecallEnabled ?? true);
    setResourceAircraftIds(entry?.activeAircraftIds ?? []);
  }, [adminArea, board, eventStep]);

  useEffect(() => {
    if (!adminPinDialog) return;
    const frame = window.requestAnimationFrame(() => adminPinInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [adminPinDialog]);

  useEffect(() => {
    if (session?.account.role !== "ADMIN") return;
    setAdminModeUnlocked(true);
    setAdminPin("000000");
    setFactoryResetPin("000000");
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
  useEffect(() => {
    if (!board || eventSettingsInitialized) return;
    setSaleOpensAt(formatEventLocalDateTime(board.event.saleOpensAt, board.event.timeZone));
    setOperationsEndAt(formatEventLocalDateTime(board.event.operationsEndAt, board.event.timeZone));
    setNoShowAfterMinutes(board.event.noShowAfterMinutes);
    setMaxTicketDeferrals(board.event.maxTicketDeferrals);
    setNotificationLeadMinutes(board.event.notificationLeadMinutes);
    setAutomaticPrecallEnabled(board.event.automaticPrecallEnabled);
    setPrecallLeadMinutes(board.event.precallLeadMinutes);
    setMaximumGateWaitMinutes(board.event.maximumGateWaitMinutes);
    setPrecallMinimumQuality(board.event.precallMinimumQuality);
    setPrecallGateCooldownMinutes(board.event.precallGateCooldownMinutes);
    setChildReferenceWeightKg(board.event.referenceWeightsKg.child);
    setNormalReferenceWeightKg(board.event.referenceWeightsKg.normal);
    setHeavyReferenceWeightKg(board.event.referenceWeightsKg.heavy);
    setPlannedBoardingMinutes(board.event.plannedBoardingMinutes);
    setPlannedDeboardingMinutes(board.event.plannedDeboardingMinutes);
    setPlannedBufferMinutes(board.event.plannedBufferMinutes);
    setDepartedVisibilitySeconds(board.event.departedVisibilitySeconds);
    setEventSettingsInitialized(true);
  }, [board, eventSettingsInitialized]);

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
      setMessage(
        cause instanceof Error ? cause.message : "Veranstaltung konnte nicht angelegt werden.",
      );
    }
  }

  async function removeEvent(eventId: string, eventName: string) {
    const confirmation = window.prompt(
      `„${eventName}“ wird vollständig gelöscht. Zum Bestätigen die technische ID eingeben:`,
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
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        reason,
      );
      if (eventId === EVENT_ID) {
        forgetActiveEvent(window.localStorage);
        window.location.assign(result.setupRequired ? "/setup" : "/");
        return;
      }
      setMessage("Veranstaltung vollständig gelöscht.");
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

  async function saveEventParameters() {
    if (!board || !operationsEndAt || adminPinRef.current.length < 4) return;
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
            saleOpensAt: saleOpensAt
              ? eventLocalDateTimeToIso(saleOpensAt, board.event.timeZone)
              : null,
            operationsEndAt: eventLocalDateTimeToIso(operationsEndAt, board.event.timeZone),
            noShowAfterMinutes,
            maxTicketDeferrals,
            notificationLeadMinutes,
            automaticPrecallEnabled,
            precallLeadMinutes,
            maximumGateWaitMinutes,
            precallMinimumQuality,
            precallGateCooldownMinutes,
            childReferenceWeightKg,
            normalReferenceWeightKg,
            heavyReferenceWeightKg,
            plannedBoardingMinutes,
            plannedDeboardingMinutes,
            plannedBufferMinutes,
            departedVisibilitySeconds,
            reason: ADMIN_CONFIGURATION_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Veranstaltungsparameter wurden protokolliert aktualisiert.");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Parameter konnten nicht gespeichert werden.",
      );
    }
  }

  async function saveEventLogo(theme: EventLogoTheme) {
    const file = eventLogoFiles[theme];
    if (!board || !file) return;
    try {
      await uploadEventLogo(
        EVENT_ID,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        board.event.version,
        theme,
        file,
      );
      setEventLogoFiles((current) => ({ ...current, [theme]: null }));
      setMessage(
        `Logo für das ${theme === "light" ? "helle" : "dunkle"} Theme gespeichert. Die Ansichten verwenden es nach dem Neuladen.`,
      );
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Logo konnte nicht gespeichert werden.");
    }
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
    const nextChildCompanion = entry?.childCompanionRequired ?? false;
    const nextWeightClasses = entry?.weightClasses ?? ["NOT_CAPTURED"];
    const nextSortOrder = entry?.sortOrder ?? 10;
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
      nextChildCompanion,
      nextWeightClasses,
      nextSortOrder,
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
    setProductChildCompanion(nextChildCompanion);
    setProductWeightClasses(nextWeightClasses);
    setProductSortOrder(nextSortOrder);
    setMasterSubmitAttempted(false);
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
            childCompanionRequired: productChildCompanion,
            weightClasses: productWeightClasses as Array<
              "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL"
            >,
            sortOrder: productSortOrder,
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

  function selectResourceForEditing(id: string) {
    const entry = resourceGroups.find((group) => group.id === id);
    const nextName = entry?.name ?? "";
    const nextShortCode = entry?.shortCode ?? "";
    const nextGateId = entry?.gateId ?? board?.gates.find((gate) => gate.active)?.id ?? "";
    const nextPlannedMinutes = entry?.plannedRotationMinutes ?? 30;
    const nextAutomaticPrecall = entry?.automaticPrecallEnabled ?? true;
    const nextAircraftIds = entry?.activeAircraftIds ?? [];
    initialMasterEditorSnapshotRef.current = createMasterEditorSnapshot([
      "resource-groups",
      nextName,
      nextShortCode,
      nextGateId,
      nextPlannedMinutes,
      nextAutomaticPrecall,
      nextAircraftIds,
    ]);
    setResourceEditorId(id);
    setResourceName(nextName);
    setResourceShortCode(nextShortCode);
    setResourceGateId(nextGateId);
    setResourcePlannedMinutes(nextPlannedMinutes);
    setResourceAutomaticPrecall(nextAutomaticPrecall);
    setResourceAircraftIds(nextAircraftIds);
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

  function selectAssignmentForEditing(aircraftId: string, resourceGroupId: string) {
    initialMasterEditorSnapshotRef.current = createMasterEditorSnapshot([
      "assignments",
      aircraftId,
      resourceGroupId,
    ]);
    setAssignmentAircraftId(aircraftId);
    setAssignmentResourceGroupId(resourceGroupId);
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
      const selectedSeats =
        board.aircraft
          .filter((aircraft) => resourceAircraftIds.includes(aircraft.id))
          .map((aircraft) => aircraft.passengerSeats) ?? [];
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
            referenceCapacity: Math.max(1, ...selectedSeats),
            plannedRotationMinutes: resourcePlannedMinutes,
            compatibleAircraftTypes: [],
            automaticPrecallEnabled: resourceAutomaticPrecall,
            aircraftIds: resourceAircraftIds,
            reason: MASTER_DATA_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Ressourcengruppe und zugeordnete Flugzeuge wurden protokolliert gespeichert.");
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

  async function assignAircraft() {
    if (
      !board ||
      !assignmentAircraftId ||
      !assignmentResourceGroupId ||
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
          type: "ASSIGN_AIRCRAFT_RESOURCE_GROUP",
          payload: {
            aircraftId: assignmentAircraftId,
            resourceGroupId: assignmentResourceGroupId,
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

  async function setResourceStatus(
    resourceGroupId: string,
    status: "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED",
  ) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_RESOURCE_GROUP_STATUS",
          payload: {
            resourceGroupId,
            status,
            reason: OPERATIONAL_AUDIT_REASON,
            expectedReviewAt: null,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(`Ressourcengruppe auf ${status} gesetzt.`);
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Statusänderung fehlgeschlagen.");
    }
  }

  async function setNotice(resourceGroupId?: string) {
    if (!board) return;
    try {
      await sendCommand(
        resourceGroupId
          ? {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "SET_RESOURCE_GROUP_NOTICE",
              payload: { resourceGroupId, note: operationalNotice.trim() },
            }
          : {
              commandId: crypto.randomUUID(),
              eventId: EVENT_ID,
              deviceId: ADMIN_DEVICE_ID,
              expectedVersion: board.event.version,
              issuedAt: new Date().toISOString(),
              type: "SET_OPERATIONAL_NOTE",
              payload: { note: operationalNotice.trim() },
            },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Betriebshinweis wurde veröffentlicht und auditiert.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Betriebshinweis fehlgeschlagen.");
    }
  }

  async function setEventInterruption(interrupted: boolean) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_EVENT_INTERRUPTION",
          payload: {
            interrupted,
            reason: OPERATIONAL_AUDIT_REASON,
            expectedReviewAt: null,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(
        interrupted ? "Flugbetrieb organisatorisch unterbrochen." : "Flugbetrieb fortgesetzt.",
      );
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Betriebsstatus konnte nicht geändert werden.",
      );
    }
  }

  async function configureProductSales(
    product: OperationBoard["products"][number],
    saleEnabled: boolean,
    useEnteredClosingTime = false,
  ) {
    if (!board || adminPinRef.current.length < 4) return;
    try {
      const configuredClosing =
        useEnteredClosingTime && saleClosesAt
          ? eventLocalDateTimeToIso(saleClosesAt, board.event.timeZone)
          : product.saleClosesAt;
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
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Verkaufssteuerung fehlgeschlagen.");
    }
  }

  async function setAircraftState(
    aircraftId: string,
    state: "AVAILABLE" | "REFUELING" | "PAUSED" | "INTERRUPTED" | "INACTIVE",
  ) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_AIRCRAFT_OPERATIONAL_STATE",
          payload: {
            aircraftId,
            state,
            reason: OPERATIONAL_AUDIT_REASON,
            expectedReviewAt: null,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Flugzeugstatus wurde organisatorisch aktualisiert und protokolliert.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeugstatus konnte nicht geändert werden.",
      );
    }
  }

  async function scheduleRefuel(aircraftId: string, planned: boolean) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SCHEDULE_AIRCRAFT_REFUEL",
          payload: { aircraftId, planned, reason: OPERATIONAL_AUDIT_REASON },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(planned ? "Tanken wurde unverbindlich vorgemerkt." : "Tankvormerkung aufgehoben.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Tankvormerkung fehlgeschlagen.");
    }
  }

  async function configureRefuelThreshold(aircraftId: string) {
    if (!board || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CONFIGURE_AIRCRAFT_REFUEL_THRESHOLD",
          payload: {
            aircraftId,
            reminderThreshold: refuelThreshold,
            reason: OPERATIONAL_AUDIT_REASON,
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Organisatorische Tank-Erinnerungsschwelle wurde aktualisiert.");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Erinnerungsschwelle fehlgeschlagen.");
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

  async function setPilotPause(pilotId: string, paused: boolean) {
    if (!board) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SET_PILOT_PAUSE",
          payload: {
            pilotId,
            paused,
            reason: OPERATIONAL_AUDIT_REASON,
            expectedReviewAt: null,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage(paused ? "Anonyme Pilotenpause gestartet." : "Anonyme Pilotenpause beendet.");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Pilotenpause fehlgeschlagen.");
    }
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
    action:
      | "gate"
      | "resource-group"
      | "aircraft"
      | "assignment"
      | "pilot"
      | "pilot-toggle"
      | "product",
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
        if (action === "assignment") await assignAircraft();
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
    if (masterDataCategory === "assignments") {
      const invalidFieldId = !assignmentAircraftId
        ? "assignment-aircraft"
        : !assignmentResourceGroupId
          ? "assignment-resource-group"
          : undefined;
      requestMasterSave("assignment", !invalidFieldId, invalidFieldId);
      return;
    }
    requestMasterSave("pilot", /^[A-Z0-9-]{2,12}$/.test(pilotCode), "pilot-operational-code");
  }

  function openFactoryReset() {
    setFactoryResetCommandId(crypto.randomUUID());
    setFactoryResetError(null);
    setMessage(null);
    setFactoryResetReason("");
    setFactoryResetPin(session?.account.role === "ADMIN" ? "000000" : "");
    setFactoryResetConfirmation("");
    setRetainRecoveryBackup(true);
    setDeleteAllBackups(false);
    setFactoryResetOpen(true);
  }

  async function performFactoryReset() {
    if (
      factoryResetBusy ||
      factoryResetReason.trim().length < 3 ||
      factoryResetPin.length < 4 ||
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

  function openSetupStep(step: SetupStep) {
    setAdminArea("events");
    setEventStep(step.id);
    if (step.category) setMasterDataCategory(step.category);
  }

  function startNewMasterDataEntry() {
    if (masterDataCategory === "gates") selectGateForEditing("new");
    if (masterDataCategory === "resource-groups") selectResourceForEditing("new");
    if (masterDataCategory === "aircraft") selectAircraftForEditing("new");
    if (masterDataCategory === "assignments") {
      const nextAircraftId = board?.aircraft[0]?.id ?? "";
      const nextResourceGroupId = board?.aircraft[0]?.resourceGroupId ?? "";
      initialMasterEditorSnapshotRef.current = createMasterEditorSnapshot([
        "assignments",
        nextAircraftId,
        nextResourceGroupId,
      ]);
      setAssignmentAircraftId(nextAircraftId);
      setAssignmentResourceGroupId(nextResourceGroupId);
      setMasterSubmitAttempted(false);
      setMasterEditorOpen(true);
    }
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
    resourceGroups.filter((group) =>
      `${group.name} ${group.gateLabel}`
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
    (board?.products ?? []).filter((product) =>
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
        : masterDataCategory === "aircraft" || masterDataCategory === "assignments"
          ? visibleAircraft
          : masterDataCategory === "pilots"
            ? visiblePilots
            : visibleProducts;
  const masterPageCount = Math.max(1, Math.ceil(activeMasterDataRows.length / masterPageSize));
  const masterPageClamped = Math.min(masterPage, masterPageCount - 1);
  const masterPageStart = masterPageClamped * masterPageSize;
  const masterPageEnd = masterPageStart + masterPageSize;
  const pagedGates = visibleGates.slice(masterPageStart, masterPageEnd);
  const pagedResourceGroups = visibleResourceGroups.slice(masterPageStart, masterPageEnd);
  const pagedAircraft = visibleAircraft.slice(masterPageStart, masterPageEnd);
  const pagedPilots = visiblePilots.slice(masterPageStart, masterPageEnd);
  const pagedProducts = visibleProducts.slice(masterPageStart, masterPageEnd);
  const selectedResourceAircraft = (board?.aircraft ?? []).filter((aircraft) =>
    resourceAircraftIds.includes(aircraft.id),
  );
  const selectedResourceCapacity = selectedResourceAircraft.reduce(
    (maximum, aircraft) => Math.max(maximum, aircraft.passengerSeats),
    0,
  );
  const productPositionChoices = productPositionOptions(board?.products ?? [], productEditorId);
  const masterDataSingularLabel: Record<MasterDataCategory, string> = {
    gates: "Gate",
    "resource-groups": "Ressourcengruppe",
    aircraft: "Flugzeug",
    assignments: "Zuordnung",
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
          : masterDataCategory === "assignments" &&
              assignmentAircraftId &&
              board?.aircraft.find((entry) => entry.id === assignmentAircraftId)?.resourceGroupId
            ? {
                entityType: "ASSIGNMENT",
                entityId: assignmentAircraftId,
                label: `Zuordnung ${board?.aircraft.find((entry) => entry.id === assignmentAircraftId)?.registration ?? ""}`,
                description: "Das Flugzeug und die Ressourcengruppe bleiben erhalten.",
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
          : masterDataCategory === "assignments"
            ? "master-assignment"
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
          : masterDataCategory === "assignments"
            ? "#assignment-aircraft"
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
    `${entry.name} ${entry.eventDate} ${entry.aerodrome}`
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
        <AdminNavigation activeArea={adminArea} onChange={setAdminArea} />
        <div className={`admin-workspace ${masterDataStepActive ? "master-data-active" : ""}`}>
          <PageHeader
            actions={
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
            }
            description={adminAreaCopy[adminArea].description}
            title={adminAreaCopy[adminArea].title}
          />
          {adminArea === "events" ? (
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
                        void runBusyAction("export-master-data-template", exportMasterDataTemplate)
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
                      onClick={() => {
                        setRestartMode("EMPTY");
                        setRestartConfirmation("");
                        setRestartEditorOpen(true);
                      }}
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
                          <a
                            href={`/admin?event=${encodeURIComponent(entry.eventId)}&area=events&step=${eventStep}`}
                          >
                            {entry.name}
                          </a>
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
                                removeEvent(entry.eventId, entry.name),
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
          ) : null}
          {adminArea === "events" ? (
            <SetupProgress currentStepId={eventStep} onSelect={openSetupStep} steps={setupSteps} />
          ) : null}
          {/* biome-ignore format: preserve the large existing workspace subtree while adding its scroll boundary */}
          <div className="admin-workspace-scroll-region" ref={adminWorkspaceScrollRef}>
            {board?.currentDeviceRole === "FLIGHT_DIRECTOR" ? (
              <div className="readonly-banner">Flugleitungsansicht · primär lesend</div>
            ) : null}
            {board ? (
              <>
              <div hidden={adminArea !== "overview"}>
                <AdminEventFlowChart
                  error={eventFlowError}
                  flow={eventFlow}
                  loading={eventFlowLoading}
                  timeZone={board.event.timeZone}
                />
              </div>
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
          {adminArea === "users" ? <AccountManagement /> : null}
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
          <section
            className="admin-section restart-editor"
            hidden={adminArea !== "events" || !restartEditorOpen}
          >
            <header className="section-heading-row">
              <h2>Neuen Betriebsstand anlegen</h2>
              <button onClick={() => setRestartEditorOpen(false)} type="button">
                Schließen
              </button>
            </header>
            <p>
              Aktive Veranstaltung: <strong>{board?.event.name ?? EVENT_ID}</strong>. Ein Neustart
              legt eine neue Veranstaltung an. Bestehende Veranstaltungen können nach dem Export
              vollständig gelöscht werden.
            </p>
            <div className="parameter-grid">
              <div className="field-control">
                <FieldLabel
                  htmlFor="restart-mode"
                  label="Neustart-Stufe"
                  help="Bestimmt, ob Stammdaten übernommen werden oder die neue Veranstaltung vollständig leer beginnt."
                />
                <select
                  id="restart-mode"
                  value={restartMode}
                  onChange={(event) =>
                    setRestartMode(event.target.value as "KEEP_MASTER_DATA" | "EMPTY")
                  }
                >
                  <option value="KEEP_MASTER_DATA">Betriebsdaten zurücksetzen</option>
                  <option value="EMPTY">Vollständig neu einrichten</option>
                </select>
              </div>
              <div className="field-control">
                <FieldLabel
                  htmlFor="new-event-id"
                  label="Technische ID"
                  help="Eindeutige, URL-taugliche Kennung der neuen Veranstaltung; zum Beispiel rundflug-2027."
                />
                <input
                  id="new-event-id"
                  value={newEventId}
                  onChange={(event) => setNewEventId(event.target.value)}
                  placeholder="rundflug-2027"
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
                  value={newEventName}
                  onChange={(event) => setNewEventName(event.target.value)}
                  placeholder="Flugtag 2027"
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
                  value={newEventAerodrome}
                  onChange={(event) => setNewEventAerodrome(event.target.value)}
                  placeholder="EDXX"
                />
              </div>
              <div className="field-control">
                <FieldLabel
                  htmlFor="restart-confirmation"
                  label="Bestätigung"
                  help="Schutz vor versehentlichem Neustart. Zur Ausführung muss NEUSTART eingegeben werden."
                />
                <input
                  id="restart-confirmation"
                  value={restartConfirmation}
                  onChange={(event) => setRestartConfirmation(event.target.value)}
                  placeholder="NEUSTART"
                  autoComplete="off"
                />
              </div>
            </div>
            <p className="help-text">
              {restartMode === "KEEP_MASTER_DATA"
                ? "Übernommen werden Parameter, Gates, Ressourcengruppen, Produkte, Flugzeugzuordnungen und Piloten-IDs. Tickets, Gruppen, Umläufe und Flugdaten beginnen leer; Verkäufe bleiben zunächst gesperrt."
                : "Nur Veranstaltungsdaten, Grundeinstellungen und das erste Administrationskonto werden angelegt. Gates, Ressourcengruppen, Produkte, Flugzeugzuordnungen, Piloten-IDs und alle Betriebsdaten beginnen leer."}
            </p>
            <Button
              busy={busyActionKey === "create-event"}
              type="button"
              disabled={
                !isAdministrator ||
                restartConfirmation !== "NEUSTART" ||
                newEventId.trim().length < 3 ||
                newEventName.trim().length < 3 ||
                !newEventDate ||
                newEventAerodrome.trim().length < 2
              }
              onClick={() => void runBusyAction("create-event", createEventFromTemplate)}
            >
              Sicheren Neustart anlegen
            </Button>
          </section>
          <div
            className="event-setup-v15 single-panel"
            hidden={adminArea !== "events" || !["event", "operations"].includes(eventStep)}
          >
            <Panel className="event-setup-details" hidden={eventStep !== "event"} padding="compact">
              <PageHeader
                actions={
                  <Button
                    disabled={!isAdministrator || !operationsEndAt}
                    busy={busyActionKey === "event-parameters"}
                    onClick={() =>
                      requestAdminAction(() =>
                        runBusyAction("event-parameters", saveEventParameters),
                      )
                    }
                    size="compact"
                    variant="primary"
                  >
                    Veranstaltungsparameter speichern
                  </Button>
                }
                level={2}
                title="Veranstaltung"
              />
              <div className="event-basics-grid">
                <TextField label="Veranstaltungsname" readOnly value={board?.event.name ?? "–"} />
                <TextField
                  label="Datum"
                  readOnly
                  value={board?.event.eventDate ? formatGermanDate(board.event.eventDate) : "–"}
                />
                <TextField
                  label="Phase"
                  readOnly
                  value={
                    board?.event.status === "PREPARATION"
                      ? "Vorbereitung"
                      : board?.event.status === "ACTIVE"
                        ? "Aktiv"
                        : board?.event.status === "CLOSED"
                          ? "Geschlossen"
                          : "–"
                  }
                />
                <TextField label="Zeitzone" readOnly value={board?.event.timeZone ?? "–"} />
                <TextField
                  className="event-aerodrome-field"
                  label="Flugplatz"
                  readOnly
                  value={board?.event.aerodrome ?? "–"}
                />
              </div>
              <div className="event-timing-grid">
                <LocalizedDateTimeInput
                  label="Verkaufsbeginn"
                  value={saleOpensAt}
                  onChange={setSaleOpensAt}
                />
                <LocalizedDateTimeInput
                  label="Betriebsende"
                  value={operationsEndAt}
                  onChange={setOperationsEndAt}
                />
              </div>
              <EventLogoEditor
                administrator={isAdministrator}
                busyActionKey={busyActionKey}
                eventId={EVENT_ID}
                eventVersion={board?.event.version ?? 0}
                files={eventLogoFiles}
                logoVariants={board?.event.logoVariants ?? NO_EVENT_LOGO_VARIANTS}
                onFileChange={(theme, file) =>
                  setEventLogoFiles((current) => ({ ...current, [theme]: file }))
                }
                onRemove={(theme) =>
                  requestAdminAction(() =>
                    runBusyAction(`clear-event-logo-${theme}`, () => clearEventLogo(theme)),
                  )
                }
                onUpload={(theme) =>
                  requestAdminAction(() =>
                    runBusyAction(`event-logo-${theme}`, () => saveEventLogo(theme)),
                  )
                }
              />
              {!operationsEndAt ? (
                <ValidationHint tone="error">
                  Ein Betriebsende muss festgelegt werden.
                </ValidationHint>
              ) : null}
              <details className="event-advanced-settings">
                <summary>Erweiterte Betriebsparameter</summary>
                <div className="event-advanced-grid">
                  <TextField
                    label="No-Show nach Minuten"
                    max="120"
                    min="1"
                    onChange={(event) => setNoShowAfterMinutes(Number(event.target.value))}
                    type="number"
                    value={noShowAfterMinutes}
                  />
                  <TextField
                    label="Klärung nach Zurückstellungen"
                    max="10"
                    min="1"
                    onChange={(event) => setMaxTicketDeferrals(Number(event.target.value))}
                    type="number"
                    value={maxTicketDeferrals}
                  />
                  <TextField
                    label="Benachrichtigungsvorlauf (Min.)"
                    max="240"
                    min="1"
                    onChange={(event) => setNotificationLeadMinutes(Number(event.target.value))}
                    type="number"
                    value={notificationLeadMinutes}
                  />
                  <TextField
                    label="Referenzgewicht Kind (kg)"
                    max="300"
                    min="1"
                    onChange={(event) => setChildReferenceWeightKg(Number(event.target.value))}
                    type="number"
                    value={childReferenceWeightKg}
                  />
                  <TextField
                    label="Referenzgewicht Normal (kg)"
                    max="300"
                    min="1"
                    onChange={(event) => setNormalReferenceWeightKg(Number(event.target.value))}
                    type="number"
                    value={normalReferenceWeightKg}
                  />
                  <TextField
                    label="Referenzgewicht Schwer (kg)"
                    max="300"
                    min="1"
                    onChange={(event) => setHeavyReferenceWeightKg(Number(event.target.value))}
                    type="number"
                    value={heavyReferenceWeightKg}
                  />
                  <TextField
                    label="Plan Boarding (Min.)"
                    max="120"
                    min="1"
                    onChange={(event) => setPlannedBoardingMinutes(Number(event.target.value))}
                    type="number"
                    value={plannedBoardingMinutes}
                  />
                  <TextField
                    label="Plan Ausstieg (Min.)"
                    max="120"
                    min="1"
                    onChange={(event) => setPlannedDeboardingMinutes(Number(event.target.value))}
                    type="number"
                    value={plannedDeboardingMinutes}
                  />
                  <TextField
                    label="Plan Puffer (Min.)"
                    max="120"
                    min="0"
                    onChange={(event) => setPlannedBufferMinutes(Number(event.target.value))}
                    type="number"
                    value={plannedBufferMinutes}
                  />
                  <TextField
                    label="Abgeflogene Zeilen sichtbar (Sek.)"
                    max="900"
                    min="5"
                    onChange={(event) => setDepartedVisibilitySeconds(Number(event.target.value))}
                    type="number"
                    value={departedVisibilitySeconds}
                  />
                  <label className="event-precall-toggle">
                    <input
                      checked={automaticPrecallEnabled}
                      onChange={(event) => setAutomaticPrecallEnabled(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Gruppen automatisch zum Gate voraufrufen</span>
                  </label>
                </div>
              </details>
            </Panel>

            <Panel
              className="event-release-v15"
              hidden={eventStep !== "operations"}
              padding="compact"
            >
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
                    {board?.event.status === "ACTIVE"
                      ? "Der Veranstaltungsbetrieb ist freigegeben."
                      : "Der Veranstaltungsbetrieb ist geschlossen."}
                  </p>
                  {board?.event.status === "ACTIVE" ? (
                    <div className="event-release-action">
                      <Button
                        disabled={!isAdministrator}
                        onClick={() => requestAdminAction(() => setEventLifecycle("CLOSED"))}
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
                    Die Veranstaltung ist noch nicht betriebsbereit. Bitte erledige die offenen
                    Punkte, um den Betrieb freizugeben.
                  </p>
                  <ul className="event-release-missing">
                    {setupSteps
                      .filter((step) => !step.complete)
                      .map((step) => (
                        <li key={step.id}>
                          <Clock3 aria-hidden="true" />
                          <Button
                            onClick={() => openSetupStep(step)}
                            size="compact"
                            variant="ghost"
                          >
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
                  {!board ? (
                    <p className="help-text">Der bestätigte Betriebsstand wird geladen.</p>
                  ) : (
                    <Button
                      disabled={!isAdministrator || !setupComplete}
                      onClick={() => requestAdminAction(() => setEventLifecycle("ACTIVE"))}
                      variant="primary"
                    >
                      <LockKeyhole aria-hidden="true" /> Betrieb freigeben
                    </Button>
                  )}
                </div>
              ) : null}
            </Panel>
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
                    onClick={() => {
                      setRestartMode("EMPTY");
                      setRestartConfirmation("");
                      setRestartEditorOpen(true);
                    }}
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
                      `${entry.name} ${entry.eventDate} ${entry.aerodrome}`
                        .toLocaleLowerCase("de-DE")
                        .includes(eventSearch.trim().toLocaleLowerCase("de-DE")),
                    )
                    .map((entry) => (
                      <tr
                        className={entry.eventId === EVENT_ID ? "is-current" : ""}
                        key={entry.eventId}
                      >
                        <td>
                          <a
                            href={`/admin?event=${encodeURIComponent(entry.eventId)}&area=events&step=event`}
                          >
                            {entry.name}
                          </a>
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
                                removeEvent(entry.eventId, entry.name),
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
          <section className="master-data-workspace" hidden={!masterDataStepActive}>
            {["aircraft", "assignments"].includes(masterDataCategory) &&
            resourceGroups.length === 0 ? (
              <ValidationHint>
                Für eine Zuordnung muss zuerst eine Ressourcengruppe angelegt sein.
              </ValidationHint>
            ) : null}
            <div className="master-data-toolbar">
              <label className="master-data-search">
                <span className="visually-hidden">Stammdaten durchsuchen</span>
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m16 16 4.5 4.5" />
                </svg>
                <input
                  onChange={(event) => setMasterSearch(event.target.value)}
                  placeholder={`${masterDataSingularLabel[masterDataCategory]} suchen`}
                  type="search"
                  value={masterSearch}
                />
              </label>
              <button className="primary-action" onClick={startNewMasterDataEntry} type="button">
                <span aria-hidden="true">+</span> {masterDataSingularLabel[masterDataCategory]}
              </button>
            </div>
            <div className="master-data-table-scroll">
              {masterDataCategory === "gates" ? (
                <table className="master-data-table">
                  <thead>
                    <tr>
                      <SortableTableHeading
                        active={masterSort.category === "gates" && masterSort.key === "label"}
                        direction={masterSort.direction}
                        label="Bezeichnung"
                        onClick={() => toggleMasterSort("label")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "gates" && masterSort.key === "type"}
                        direction={masterSort.direction}
                        label="Typ"
                        onClick={() => toggleMasterSort("type")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "gates" && masterSort.key === "status"}
                        direction={masterSort.direction}
                        label="Status"
                        onClick={() => toggleMasterSort("status")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "gates" && masterSort.key === "sortOrder"}
                        direction={masterSort.direction}
                        label="Sortierung"
                        onClick={() => toggleMasterSort("sortOrder")}
                      />
                      <th>Ressourcengruppen</th>
                      <th>Displayfilter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedGates.map((gate) => (
                      <tr
                        className={masterEditorOpen && gateEditorId === gate.id ? "selected" : ""}
                        key={gate.id}
                        onClick={() => selectGateForEditing(gate.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            selectGateForEditing(gate.id);
                        }}
                        tabIndex={0}
                      >
                        <td>{gate.label}</td>
                        <td>{gate.gateType}</td>
                        <td>
                          <span className={`status-text ${gate.active ? "active" : "inactive"}`}>
                            {gate.active ? "Aktiv" : "Inaktiv"}
                          </span>
                        </td>
                        <td>{gate.sortOrder}</td>
                        <td>{gate.assignedResourceGroupIds.length}</td>
                        <td>
                          {gate.displayFilter.productIds.length} Produkte ·{" "}
                          {gate.displayFilter.rotationStatuses.length} Status
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {masterDataCategory === "resource-groups" ? (
                <table className="master-data-table resource-group-list-table">
                  <thead>
                    <tr>
                      <SortableTableHeading
                        active={
                          masterSort.category === "resource-groups" && masterSort.key === "name"
                        }
                        direction={masterSort.direction}
                        label="Ressourcengruppe"
                        onClick={() => toggleMasterSort("name")}
                      />
                      <SortableTableHeading
                        active={
                          masterSort.category === "resource-groups" && masterSort.key === "status"
                        }
                        direction={masterSort.direction}
                        label="Status"
                        onClick={() => toggleMasterSort("status")}
                      />
                      <SortableTableHeading
                        active={
                          masterSort.category === "resource-groups" && masterSort.key === "gate"
                        }
                        direction={masterSort.direction}
                        label="Gate"
                        onClick={() => toggleMasterSort("gate")}
                      />
                      <SortableTableHeading
                        active={
                          masterSort.category === "resource-groups" && masterSort.key === "aircraft"
                        }
                        direction={masterSort.direction}
                        label="Flugzeuge"
                        onClick={() => toggleMasterSort("aircraft")}
                      />
                      <SortableTableHeading
                        active={
                          masterSort.category === "resource-groups" && masterSort.key === "capacity"
                        }
                        direction={masterSort.direction}
                        label="Kapazität"
                        onClick={() => toggleMasterSort("capacity")}
                      />
                      <th>Plan / Voraufruf</th>
                      <th>Produkte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedResourceGroups.map((group) => (
                      <tr
                        className={
                          masterEditorOpen && resourceEditorId === group.id ? "selected" : ""
                        }
                        key={group.id}
                        onClick={() => selectResourceForEditing(group.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            selectResourceForEditing(group.id);
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <strong>{group.name}</strong>
                          <small>{group.shortCode}</small>
                        </td>
                        <td>
                          <span
                            className={`status-text ${group.status === "ACTIVE" ? "active" : "inactive"}`}
                          >
                            {group.status === "ACTIVE" ? "Aktiv" : group.status}
                          </span>
                        </td>
                        <td>{group.gateLabel}</td>
                        <td>
                          {(board?.aircraft ?? [])
                            .filter((aircraft) => group.activeAircraftIds.includes(aircraft.id))
                            .map((aircraft) => aircraft.registration)
                            .join(", ") || "Keine"}
                        </td>
                        <td>{group.referenceCapacity}</td>
                        <td>
                          {group.plannedRotationMinutes} Min. ·{" "}
                          {group.automaticPrecallEnabled ? "automatisch" : "manuell"}
                        </td>
                        <td>
                          {board?.products.filter((product) => product.resourceGroupId === group.id)
                            .length ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {masterDataCategory === "aircraft" ? (
                <table className="master-data-table">
                  <thead>
                    <tr>
                      <SortableTableHeading
                        active={
                          masterSort.category === "aircraft" && masterSort.key === "registration"
                        }
                        direction={masterSort.direction}
                        label="Kennung"
                        onClick={() => toggleMasterSort("registration")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "aircraft" && masterSort.key === "type"}
                        direction={masterSort.direction}
                        label="Flugzeugtyp"
                        onClick={() => toggleMasterSort("type")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "aircraft" && masterSort.key === "seats"}
                        direction={masterSort.direction}
                        label="Sitzplätze"
                        onClick={() => toggleMasterSort("seats")}
                      />
                      <th>Max. Zuladung</th>
                      <SortableTableHeading
                        active={masterSort.category === "aircraft" && masterSort.key === "group"}
                        direction={masterSort.direction}
                        label="Ressourcengruppe"
                        onClick={() => toggleMasterSort("group")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "aircraft" && masterSort.key === "pilot"}
                        direction={masterSort.direction}
                        label="Pilotencode"
                        onClick={() => toggleMasterSort("pilot")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "aircraft" && masterSort.key === "status"}
                        direction={masterSort.direction}
                        label="Status"
                        onClick={() => toggleMasterSort("status")}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedAircraft.map((aircraft) => (
                      <tr
                        className={
                          masterEditorOpen && aircraftEditorId === aircraft.id ? "selected" : ""
                        }
                        key={aircraft.id}
                        onClick={() => selectAircraftForEditing(aircraft.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            selectAircraftForEditing(aircraft.id);
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <strong>{aircraft.registration}</strong>
                        </td>
                        <td>{aircraft.aircraftType}</td>
                        <td>{aircraft.passengerSeats}</td>
                        <td>
                          {aircraft.maximumPassengerPayloadKg
                            ? `${aircraft.maximumPassengerPayloadKg} kg`
                            : "Nicht erfasst"}
                        </td>
                        <td>{aircraft.resourceGroupName || "Nicht zugeordnet"}</td>
                        <td>{aircraft.currentPilotOperationalCode || "Nicht zugeordnet"}</td>
                        <td>
                          <span
                            className={`status-text ${aircraft.operationalState === "INACTIVE" ? "inactive" : "active"}`}
                          >
                            {aircraftStateLabel[aircraft.operationalState]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {masterDataCategory === "assignments" ? (
                <table className="master-data-table">
                  <thead>
                    <tr>
                      <th>Flugzeug</th>
                      <th>Flugzeugtyp</th>
                      <th>Aktuelle Ressourcengruppe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedAircraft.map((aircraft) => (
                      <tr
                        className={
                          masterEditorOpen && assignmentAircraftId === aircraft.id ? "selected" : ""
                        }
                        key={aircraft.id}
                        onClick={() =>
                          selectAssignmentForEditing(aircraft.id, aircraft.resourceGroupId)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            selectAssignmentForEditing(aircraft.id, aircraft.resourceGroupId);
                          }
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <strong>{aircraft.registration}</strong>
                        </td>
                        <td>{aircraft.aircraftType}</td>
                        <td>{aircraft.resourceGroupName || "Nicht zugeordnet"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {masterDataCategory === "pilots" ? (
                <table className="master-data-table">
                  <thead>
                    <tr>
                      <SortableTableHeading
                        active={masterSort.category === "pilots" && masterSort.key === "code"}
                        direction={masterSort.direction}
                        label="Operativer Code"
                        onClick={() => toggleMasterSort("code")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "pilots" && masterSort.key === "note"}
                        direction={masterSort.direction}
                        label="Organisatorische Bemerkung"
                        onClick={() => toggleMasterSort("note")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "pilots" && masterSort.key === "status"}
                        direction={masterSort.direction}
                        label="Status"
                        onClick={() => toggleMasterSort("status")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "pilots" && masterSort.key === "rotation"}
                        direction={masterSort.direction}
                        label="Aktueller Umlauf"
                        onClick={() => toggleMasterSort("rotation")}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPilots.map((pilot) => (
                      <tr
                        className={masterEditorOpen && pilotEditorId === pilot.id ? "selected" : ""}
                        key={pilot.id}
                        onClick={() => selectPilotForEditing(pilot.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            selectPilotForEditing(pilot.id);
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <strong>{pilot.operationalCode}</strong>
                        </td>
                        <td>{pilot.operationalNote || "Keine Bemerkung"}</td>
                        <td>
                          <span className={`status-text ${pilot.active ? "active" : "inactive"}`}>
                            {pilot.active ? (pilot.paused ? "Pause" : "Aktiv") : "Inaktiv"}
                          </span>
                        </td>
                        <td>
                          {pilot.currentCommunicationNumber
                            ? `Fluggruppe ${pilot.currentCommunicationNumber}`
                            : "Nicht zugeordnet"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {masterDataCategory === "products" ? (
                <table className="master-data-table">
                  <thead>
                    <tr>
                      <SortableTableHeading
                        active={masterSort.category === "products" && masterSort.key === "code"}
                        direction={masterSort.direction}
                        label="Kürzel"
                        onClick={() => toggleMasterSort("code")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "products" && masterSort.key === "name"}
                        direction={masterSort.direction}
                        label="Bezeichnung"
                        onClick={() => toggleMasterSort("name")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "products" && masterSort.key === "group"}
                        direction={masterSort.direction}
                        label="Ressourcengruppe"
                        onClick={() => toggleMasterSort("group")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "products" && masterSort.key === "gate"}
                        direction={masterSort.direction}
                        label="Gate"
                        onClick={() => toggleMasterSort("gate")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "products" && masterSort.key === "price"}
                        direction={masterSort.direction}
                        label="Preis"
                        onClick={() => toggleMasterSort("price")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "products" && masterSort.key === "duration"}
                        direction={masterSort.direction}
                        label="Referenzdauer"
                        onClick={() => toggleMasterSort("duration")}
                      />
                      <SortableTableHeading
                        active={masterSort.category === "products" && masterSort.key === "status"}
                        direction={masterSort.direction}
                        label="Status"
                        onClick={() => toggleMasterSort("status")}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedProducts.map((product) => (
                      <tr
                        className={
                          masterEditorOpen && productEditorId === product.id ? "selected" : ""
                        }
                        key={product.id}
                        onClick={() => selectProductForEditing(product.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ")
                            selectProductForEditing(product.id);
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <strong>{product.code}</strong>
                        </td>
                        <td>{product.name}</td>
                        <td>{product.resourceGroupName}</td>
                        <td>{product.gateLabel}</td>
                        <td>
                          {(product.priceCents / 100).toLocaleString("de-DE", {
                            style: "currency",
                            currency: "EUR",
                          })}
                        </td>
                        <td>{product.referenceDurationMinutes} Min.</td>
                        <td>
                          <span
                            className={`status-text ${product.saleEnabled ? "active" : "inactive"}`}
                          >
                            {product.saleEnabled ? "Verkauf aktiv" : "Verkauf gesperrt"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {(masterDataCategory === "gates" && (board?.gates.length ?? 0) === 0) ||
              (masterDataCategory === "resource-groups" && resourceGroups.length === 0) ||
              (masterDataCategory === "aircraft" && (board?.aircraft.length ?? 0) === 0) ||
              (masterDataCategory === "assignments" && (board?.aircraft.length ?? 0) === 0) ||
              (masterDataCategory === "pilots" && (board?.pilots.length ?? 0) === 0) ||
              (masterDataCategory === "products" && (board?.products.length ?? 0) === 0) ? (
                <div className="master-data-empty">
                  <strong>
                    Noch keine{" "}
                    {masterDataCategory === "gates"
                      ? "Gates"
                      : masterDataCategory === "resource-groups"
                        ? "Ressourcengruppe"
                        : masterDataCategory === "aircraft"
                          ? "Flugzeuge"
                          : masterDataCategory === "assignments"
                            ? "Flugzeuge für eine Zuordnung"
                            : masterDataCategory === "pilots"
                              ? "Pilotencodes"
                              : "Produkte"}{" "}
                    angelegt
                  </strong>
                  <p>
                    {masterDataCategory === "resource-groups"
                      ? "Eine Ressourcengruppe benötigt ein aktives Gate."
                      : masterDataCategory === "products"
                        ? "Ein Produkt benötigt eine Ressourcengruppe und ein aktives Gate."
                        : masterDataCategory === "assignments"
                          ? "Legen Sie zuerst ein Flugzeug und eine Ressourcengruppe an."
                          : "Mit der Schaltfläche oben kann der erste Datensatz angelegt werden."}
                  </p>
                  {masterDataCategory === "resource-groups" ? (
                    <button
                      className="table-action"
                      onClick={() => setMasterDataCategory("gates")}
                      type="button"
                    >
                      Gate verwalten
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {activeMasterDataRows.length > 0 ? (
              <div className="ds-pagination">
                <div className="ds-pagination-size">
                  <label htmlFor="master-data-page-size">Zeilen pro Seite</label>
                  <select
                    id="master-data-page-size"
                    onChange={(event) => setMasterPageSize(Number(event.target.value))}
                    value={masterPageSize}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>
                <span>
                  {masterPageStart + 1}–{Math.min(activeMasterDataRows.length, masterPageEnd)} von{" "}
                  {activeMasterDataRows.length}
                </span>
                <nav aria-label="Seitennavigation" className="ds-pagination-nav">
                  <button
                    aria-label="Erste Seite"
                    disabled={masterPageClamped === 0}
                    onClick={() => setMasterPage(0)}
                    type="button"
                  >
                    «
                  </button>
                  <button
                    aria-label="Vorherige Seite"
                    disabled={masterPageClamped === 0}
                    onClick={() => setMasterPage((value) => Math.max(0, value - 1))}
                    type="button"
                  >
                    ‹
                  </button>
                  <button className="current" disabled type="button">
                    {masterPageClamped + 1}
                  </button>
                  <button
                    aria-label="Nächste Seite"
                    disabled={masterPageClamped >= masterPageCount - 1}
                    onClick={() =>
                      setMasterPage((value) => Math.min(masterPageCount - 1, value + 1))
                    }
                    type="button"
                  >
                    ›
                  </button>
                  <button
                    aria-label="Letzte Seite"
                    disabled={masterPageClamped >= masterPageCount - 1}
                    onClick={() => setMasterPage(masterPageCount - 1)}
                    type="button"
                  >
                    »
                  </button>
                </nav>
              </div>
            ) : null}
          </section>
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
              <fieldset hidden={masterDataCategory !== "gates"}>
                <legend>Gate</legend>
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
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={gateActive}
                      onChange={(event) => setGateActive(event.target.checked)}
                    />
                    <span>Gate ist aktiv</span>
                  </label>
                </div>
                <section
                  className="gate-display-filter"
                  aria-labelledby="gate-display-filter-title"
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
                      {board?.products.map((product) => (
                        <label className="checkbox-label" key={product.id}>
                          <input
                            checked={gateDisplayProductIds.includes(product.id)}
                            onChange={() =>
                              setGateDisplayProductIds((current) =>
                                current.includes(product.id)
                                  ? current.filter((id) => id !== product.id)
                                  : [...current, product.id],
                              )
                            }
                            type="checkbox"
                          />
                          <span>{product.name}</span>
                        </label>
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
                        <label className="checkbox-label" key={status}>
                          <input
                            checked={gateDisplayRotationStatuses.includes(status)}
                            onChange={() =>
                              setGateDisplayRotationStatuses((current) =>
                                current.includes(status)
                                  ? current.filter((entry) => entry !== status)
                                  : [...current, status],
                              )
                            }
                            type="checkbox"
                          />
                          <span>{label}</span>
                        </label>
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
              <fieldset hidden={masterDataCategory !== "products"}>
                <legend>Produkt</legend>
                <section className="product-editor-section">
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
                <section className="product-editor-section">
                  <h3>Planung</h3>
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
                        label="Referenzdauer"
                        help="Planwert für den Kaltstart der Prognose, keine zugesagte Flugzeit."
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
                        label="Zugesagte Flugzeit (Min.)"
                        help="Öffentlich kommunizierte reine Flugzeit des Produkts. Sie ändert die operative Prognose nicht."
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
                        htmlFor="product-sort-order"
                        label="Position in Anzeigen"
                        help="Legt nur die Reihenfolge in Kasse und Anzeigen fest. Queue und Priorität ändern sich dadurch nicht."
                      />
                      <select
                        id="product-sort-order"
                        value={productSortOrder}
                        onChange={(event) => setProductSortOrder(Number(event.target.value))}
                      >
                        {productPositionChoices.map((option) => (
                          <option key={`${option.value}-${option.label}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>
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
            open={
              masterDataStepActive &&
              masterEditorOpen &&
              ["resource-groups", "aircraft", "assignments"].includes(masterDataCategory)
            }
            size={masterDataCategory === "resource-groups" ? "wide" : "default"}
            title={
              masterDataCategory === "resource-groups"
                ? resourceEditorId === "new"
                  ? "Ressourcengruppe anlegen"
                  : "Ressourcengruppe bearbeiten"
                : masterDataCategory === "assignments"
                  ? "Zuordnung ändern"
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
                <div className="field-control">
                  <FieldLabel
                    htmlFor="resource-planned-minutes"
                    label="Plan-Umlaufzeit (Min.)"
                    help="Initialer Zeitwert eines vollständigen Umlaufs für die Prognose."
                  />
                  <input
                    id="resource-planned-minutes"
                    type="number"
                    min="1"
                    max="600"
                    value={resourcePlannedMinutes}
                    onChange={(event) => setResourcePlannedMinutes(Number(event.target.value))}
                  />
                </div>
                <div className="admin-check-row">
                  <input
                    checked={resourceAutomaticPrecall}
                    id="resource-automatic-precall"
                    onChange={(event) => setResourceAutomaticPrecall(event.target.checked)}
                    type="checkbox"
                  />
                  <FieldLabel
                    htmlFor="resource-automatic-precall"
                    label="Automatischer Voraufruf für diese Gruppe"
                    help="Kann für einzelne Ressourcengruppen abgeschaltet werden. Belegung, Pilot und Boarding bleiben immer manuell bestätigt."
                  />
                </div>
                <section className="resource-aircraft-selection">
                  <h3>Flugzeuge dieser Ressourcengruppe</h3>
                  <p>
                    Kapazität und passende Gruppengröße werden automatisch aus diesen Flugzeugen
                    ermittelt.
                  </p>
                  {board?.aircraft.map((aircraft) => (
                    <label className="checkbox-label" key={aircraft.id}>
                      <input
                        checked={resourceAircraftIds.includes(aircraft.id)}
                        onChange={(event) =>
                          setResourceAircraftIds((current) =>
                            event.target.checked
                              ? [...current, aircraft.id]
                              : current.filter((id) => id !== aircraft.id),
                          )
                        }
                        type="checkbox"
                      />
                      <span>
                        <strong>{aircraft.registration}</strong> · {aircraft.aircraftType} ·{" "}
                        {aircraft.passengerSeats} Plätze
                        {aircraft.resourceGroupId && aircraft.resourceGroupId !== resourceEditorId
                          ? ` · aktuell ${aircraft.resourceGroupName}`
                          : ""}
                      </span>
                    </label>
                  ))}
                  {board?.aircraft.length === 0 ? (
                    <ValidationHint>
                      Zuerst mindestens ein Flugzeug anlegen; die Zuordnung kann anschließend hier
                      erfolgen.
                    </ValidationHint>
                  ) : null}
                </section>
                <section
                  className="derived-resource-summary"
                  aria-label="Abgeleitete Zusammenfassung"
                >
                  <strong>Zusammenfassung (abgeleitet)</strong>
                  <span>
                    {selectedResourceAircraft.length} Flugzeug
                    {selectedResourceAircraft.length === 1 ? "" : "e"} · Kapazität{" "}
                    {selectedResourceCapacity || "–"}{" "}
                    {selectedResourceCapacity === 1 ? "Platz" : "Plätze"} · Gruppen bis{" "}
                    {selectedResourceCapacity || "–"} Personen ohne Teilung
                  </span>
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
                {masterSubmitAttempted &&
                (aircraftRegistration.trim().length < 3 || aircraftType.trim().length < 2) ? (
                  <ValidationHint tone="error">
                    Kennzeichen und Flugzeugtyp müssen mindestens 2 Zeichen lang sein.
                  </ValidationHint>
                ) : null}
              </fieldset>
              <fieldset hidden={masterDataCategory !== "assignments"}>
                <legend>Historisierte Zuordnung</legend>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="assignment-aircraft"
                    label="Flugzeug"
                    help="Flugzeug, dessen aktive Ressourcengruppenzuordnung geändert werden soll."
                  />
                  <select
                    id="assignment-aircraft"
                    value={assignmentAircraftId}
                    onChange={(event) => setAssignmentAircraftId(event.target.value)}
                  >
                    <option value="">Bitte wählen</option>
                    {board?.aircraft.map((aircraft) => (
                      <option key={aircraft.id} value={aircraft.id}>
                        {aircraft.registration} · {aircraft.resourceGroupName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="assignment-resource-group"
                    label="Neue Ressourcengruppe"
                    help="Zielgruppe der neuen historisierten Zuordnung. Ein Flugzeug kann gleichzeitig nur einer aktiven Gruppe angehören."
                  />
                  <select
                    id="assignment-resource-group"
                    value={assignmentResourceGroupId}
                    onChange={(event) => setAssignmentResourceGroupId(event.target.value)}
                  >
                    <option value="">Bitte wählen</option>
                    {resourceGroups
                      .filter((group) => group.status !== "ENDED")
                      .map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                  </select>
                </div>
                <p>
                  Wirksam ab Bestätigung. Aktive Umläufe und inkompatible Flugzeugtypen werden
                  serverseitig abgewiesen.
                </p>
                {masterSubmitAttempted && (!assignmentAircraftId || !assignmentResourceGroupId) ? (
                  <ValidationHint tone="error">
                    Flugzeug und neue Ressourcengruppe müssen ausgewählt werden.
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
                  Synthetische Szenarien, Prognoseparameter und A/B-Vergleiche vollständig im
                  Browser untersuchen. Es werden keine Betriebsdaten verwendet oder gespeichert.
                </p>
              </div>
            </div>
            <a
              className="admin-simulator-launch-action"
              href="/simulation"
              rel="noopener"
              target="_blank"
            >
              Prognose-Simulator öffnen
              <ExternalLink aria-hidden="true" />
            </a>
          </section>
          <section
            className="admin-section admin-emergency-section"
            hidden={adminArea !== "events" || eventStep !== "operations"}
          >
            <h2>Notfallmodus</h2>
            <div className="field-control">
              <FieldLabel
                htmlFor="emergency-reason"
                label="Begründung für den Notfallmodus"
                help="Nur außergewöhnliche Eingriffe benötigen einen frei eingegebenen Grund. Normale Betriebsänderungen werden automatisch protokolliert."
              />
              <input
                id="emergency-reason"
                onChange={(event) => setReason(event.target.value)}
                placeholder="Mindestens 3 Zeichen"
                value={reason}
              />
            </div>
            {!board?.event.emergencyMode ? (
              <Button
                busy={busyActionKey === "emergency-trigger"}
                className="danger-action"
                disabled={reason.trim().length < 3 || busyActionKey !== null}
                onClick={() =>
                  runBusyAction("emergency-trigger", () => emergency("TRIGGER_EMERGENCY"))
                }
                type="button"
                variant="danger"
              >
                Not-Halt auslösen
              </Button>
            ) : (
              <Button
                busy={busyActionKey === "emergency-clear"}
                className="danger-action"
                disabled={!isAdministrator || reason.trim().length < 3 || busyActionKey !== null}
                onClick={() =>
                  requestAdminAction(() =>
                    runBusyAction("emergency-clear", () => emergency("CLEAR_EMERGENCY")),
                  )
                }
                type="button"
                variant="danger"
              >
                Notfallmodus aufheben
              </Button>
            )}
          </section>
          <section className="admin-section" hidden>
            <h2>Laufende Umläufe</h2>
            <div className="active-rotation-list">
              {board?.rotations
                .filter((rotation) => ["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status))
                .map((rotation) => (
                  <div key={rotation.id}>
                    <strong>{rotation.communicationLabel}</strong>
                    <span>{rotation.status}</span>
                    <span>{rotation.aircraftRegistration ?? "Flugzeug offen"}</span>
                    <span>Pilotencode {rotation.pilotOperationalCode ?? "offen"}</span>
                  </div>
                ))}
              {board && board.metrics.activeRotations === 0 ? (
                <p>Keine laufenden Umläufe.</p>
              ) : null}
            </div>
          </section>
          <section
            className="admin-section manifest-correction"
            hidden={adminArea !== "events" || eventStep !== "completion"}
          >
            <div className="section-heading">
              <div>
                <h2>Dokumentierte Besetzung korrigieren</h2>
                <p>
                  Seltener Admin-Sonderweg nach dem Flugstart. Eine anonyme Buchungsgruppe wird
                  immer vollständig einem bereits gestarteten oder abgeschlossenen Umlauf
                  zugeordnet.
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
                  help="Es werden nur anonyme Gruppen angeboten, deren dokumentierter Umlauf bereits im Flug, gelandet oder abgeschlossen ist."
                />
                <select
                  id="manifest-ticket-group"
                  value={manifestTicketGroupId}
                  onChange={(event) => {
                    setManifestTicketGroupId(event.target.value);
                    setManifestTargetRotationId("");
                  }}
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
                  help="Der Zielumlauf muss mindestens den Status Im Flug erreicht haben. Bisherige Umläufe der Gruppe sind ausgeschlossen."
                />
                <select
                  disabled={!selectedManifestCandidate}
                  id="manifest-target-rotation"
                  value={manifestTargetRotationId}
                  onChange={(event) => setManifestTargetRotationId(event.target.value)}
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
                  help="Mindestens 10 Zeichen. Der Grund wird zusammen mit Quelle, Ziel, Gerät und Version dauerhaft auditiert."
                />
                <textarea
                  id="manifest-correction-reason"
                  maxLength={500}
                  placeholder="Zum Beispiel: Tatsächliche Besetzung nach Rückmeldung der Flight Line berichtigen"
                  value={manifestCorrectionReason}
                  onChange={(event) => setManifestCorrectionReason(event.target.value)}
                />
                <small>{manifestCorrectionReason.trim().length}/10 Mindestzeichen</small>
              </div>
            </div>
            {selectedManifestCandidate ? (
              <div className="manifest-correction-preview">
                <div>
                  <span>Bisher dokumentiert</span>
                  <strong>{selectedManifestCandidate.label}</strong>
                </div>
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
          <section className="admin-section" hidden>
            <h2>Betriebs- und Wetterhinweise</h2>
            <div className="field-control">
              <FieldLabel
                htmlFor="operational-notice"
                label="Organisatorischer Hinweis"
                help="Öffentlich sichtbare Information ohne automatische Auswirkung auf Verkauf oder Flugbetrieb."
              />
              <input
                id="operational-notice"
                value={operationalNotice}
                maxLength={240}
                onChange={(event) => setOperationalNotice(event.target.value)}
                placeholder="Hinweis setzen oder leer speichern zum Entfernen"
              />
            </div>
            <div className="secondary-actions notice-actions">
              <Button
                busy={busyActionKey === "notice-event"}
                disabled={busyActionKey !== null && busyActionKey !== "notice-event"}
                onClick={() => runBusyAction("notice-event", () => setNotice())}
                type="button"
              >
                Für gesamte Veranstaltung veröffentlichen
              </Button>
              {resourceGroups.map((group) => (
                <Button
                  busy={busyActionKey === `notice-${group.id}`}
                  disabled={busyActionKey !== null && busyActionKey !== `notice-${group.id}`}
                  key={group.id}
                  onClick={() => runBusyAction(`notice-${group.id}`, () => setNotice(group.id))}
                  type="button"
                >
                  Für {group.name} veröffentlichen
                </Button>
              ))}
            </div>
            <Button
              busy={busyActionKey === "event-interruption"}
              className="interrupt-action"
              disabled={busyActionKey !== null && busyActionKey !== "event-interruption"}
              onClick={() =>
                runBusyAction("event-interruption", () =>
                  setEventInterruption(!(board?.event.operationalInterrupted ?? false)),
                )
              }
              type="button"
            >
              {board?.event.operationalInterrupted
                ? "Veranstaltungsbetrieb fortsetzen"
                : "Veranstaltungsbetrieb unterbrechen"}
            </Button>
            <p>Hinweise stoppen keinen Flugbetrieb. Unterbrechungen werden separat gesetzt.</p>
          </section>
          <section
            className="admin-section admin-capacity-section"
            hidden={adminArea !== "events" || eventStep !== "operations"}
          >
            <h2>Kapazität und Verkaufsempfehlung</h2>
            <LocalizedDateTimeInput
              label="Neuer harter Verkaufsschluss"
              labelContent={
                <FieldGroupLabel
                  label="Neuer harter Verkaufsschluss"
                  help="Nach diesem lokalen Zeitpunkt werden für das gewählte Produkt keine neuen Verkäufe akzeptiert."
                />
              }
              value={saleClosesAt}
              onChange={setSaleClosesAt}
            />
            <div className="capacity-overview">
              {board?.products.map((product) => (
                <div className="capacity-row" key={product.id}>
                  <div>
                    <strong>{product.name}</strong>
                    <span>{capacityLabel[product.capacityStatus]}</span>
                  </div>
                  <div>
                    <strong>{product.remainingSellableSeats}</strong>
                    <span>vorsichtig kalkulierte Restplätze</span>
                  </div>
                  <div>
                    <strong>
                      {product.saleRecommended ? "Verkauf empfohlen" : "Nicht verkaufen"}
                    </strong>
                    <span>Prognose {predictionQualityLabel[product.predictionQuality]}</span>
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
                      busy={busyActionKey === `product-${product.id}-closing`}
                      disabled={!isAdministrator || !saleClosesAt || busyActionKey !== null}
                      onClick={() =>
                        requestAdminAction(() =>
                          runBusyAction(`product-${product.id}-closing`, () =>
                            configureProductSales(product, product.saleEnabled, true),
                          ),
                        )
                      }
                      type="button"
                    >
                      Verkaufsschluss setzen
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="admin-section" hidden>
            <h2>Flotte, Tanken und Pausen</h2>
            <p className="safety-disclaimer">
              Ausschließlich organisatorische Hinweise – keine flugbetriebliche oder
              sicherheitsbezogene Freigabewirkung.
            </p>
            <div className="fleet-list">
              {board?.aircraft.map((aircraft) => (
                <div className="fleet-row" key={aircraft.id}>
                  <div>
                    <strong>{aircraft.registration}</strong>
                    <span>
                      {aircraft.aircraftType} · {aircraft.passengerSeats} Sitze
                    </span>
                    <span>Queue {aircraft.resourceGroupName}</span>
                  </div>
                  <div>
                    <strong>{aircraftStateLabel[aircraft.operationalState]}</strong>
                    <span>
                      {aircraft.rotationsSinceRefuel}/{aircraft.refuelReminderThreshold} Umläufe
                      seit Tanken
                    </span>
                    {aircraft.refuelPlanned ? (
                      <span className="warning-text">Tanken vorgemerkt</span>
                    ) : null}
                  </div>
                  <div className="secondary-actions fleet-actions">
                    <Button
                      busy={busyActionKey === `aircraft-${aircraft.id}-available`}
                      disabled={
                        busyActionKey !== null ||
                        !["REFUELING", "PAUSED", "INACTIVE", "INTERRUPTED"].includes(
                          aircraft.operationalState,
                        )
                      }
                      onClick={() =>
                        runBusyAction(`aircraft-${aircraft.id}-available`, () =>
                          setAircraftState(aircraft.id, "AVAILABLE"),
                        )
                      }
                      type="button"
                    >
                      Verfügbar
                    </Button>
                    <Button
                      busy={busyActionKey === `aircraft-${aircraft.id}-paused`}
                      disabled={busyActionKey !== null || aircraft.operationalState !== "AVAILABLE"}
                      onClick={() =>
                        runBusyAction(`aircraft-${aircraft.id}-paused`, () =>
                          setAircraftState(aircraft.id, "PAUSED"),
                        )
                      }
                      type="button"
                    >
                      Pause
                    </Button>
                    <Button
                      busy={busyActionKey === `aircraft-${aircraft.id}-refueling`}
                      disabled={busyActionKey !== null || aircraft.operationalState !== "AVAILABLE"}
                      onClick={() =>
                        runBusyAction(`aircraft-${aircraft.id}-refueling`, () =>
                          setAircraftState(aircraft.id, "REFUELING"),
                        )
                      }
                      type="button"
                    >
                      Tanken aktuell
                    </Button>
                    <Button
                      busy={busyActionKey === `aircraft-${aircraft.id}-inactive`}
                      disabled={busyActionKey !== null || aircraft.operationalState !== "AVAILABLE"}
                      onClick={() =>
                        runBusyAction(`aircraft-${aircraft.id}-inactive`, () =>
                          setAircraftState(aircraft.id, "INACTIVE"),
                        )
                      }
                      type="button"
                    >
                      Inaktiv
                    </Button>
                    <Button
                      busy={busyActionKey === `aircraft-${aircraft.id}-interrupted`}
                      disabled={busyActionKey !== null || aircraft.operationalState !== "AVAILABLE"}
                      onClick={() =>
                        runBusyAction(`aircraft-${aircraft.id}-interrupted`, () =>
                          setAircraftState(aircraft.id, "INTERRUPTED"),
                        )
                      }
                      type="button"
                    >
                      Unterbrechen
                    </Button>
                    <Button
                      busy={busyActionKey === `aircraft-${aircraft.id}-schedule-refuel`}
                      disabled={busyActionKey !== null}
                      onClick={() =>
                        runBusyAction(`aircraft-${aircraft.id}-schedule-refuel`, () =>
                          scheduleRefuel(aircraft.id, !aircraft.refuelPlanned),
                        )
                      }
                      type="button"
                    >
                      {aircraft.refuelPlanned ? "Vormerkung aufheben" : "Tanken vormerken"}
                    </Button>
                    <Button
                      busy={busyActionKey === `aircraft-${aircraft.id}-threshold`}
                      disabled={!isAdministrator || busyActionKey !== null}
                      onClick={() =>
                        requestAdminAction(() =>
                          runBusyAction(`aircraft-${aircraft.id}-threshold`, () =>
                            configureRefuelThreshold(aircraft.id),
                          ),
                        )
                      }
                      type="button"
                    >
                      Schwelle {refuelThreshold} setzen
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="field-control threshold-input">
              <FieldLabel
                htmlFor="refuel-threshold"
                label="Umläufe bis Tank-Erinnerung"
                help="Rein organisatorischer Erinnerungswert je Flugzeug; keine Kraftstoff- oder Freigabeentscheidung."
              />
              <input
                id="refuel-threshold"
                type="number"
                min={1}
                max={100}
                value={refuelThreshold}
                onChange={(event) => setRefuelThreshold(Number(event.target.value))}
              />
            </div>
            <h3>Pilotenpausen</h3>
            <p className="help-text">
              Pilotencodes und organisatorische Bemerkungen werden unter Stammdaten verwaltet.
            </p>
            <div className="pilot-list">
              {board?.pilots.map((pilot) => (
                <div key={pilot.id}>
                  <strong>{pilot.operationalCode}</strong>
                  <span>{pilot.active ? (pilot.paused ? "Pause" : "aktiv") : "inaktiv"}</span>
                  <span>{pilot.operationalNote || "Keine organisatorische Bemerkung"}</span>
                  <span>
                    {pilot.currentCommunicationNumber
                      ? `Aktuell Fluggruppe ${pilot.currentCommunicationNumber}`
                      : "Aktuell keinem Umlauf zugeordnet"}
                  </span>
                  <Button
                    busy={busyActionKey === `pilot-${pilot.id}-pause`}
                    disabled={!pilot.active || busyActionKey !== null}
                    onClick={() =>
                      runBusyAction(`pilot-${pilot.id}-pause`, () =>
                        setPilotPause(pilot.id, !pilot.paused),
                      )
                    }
                    type="button"
                  >
                    {pilot.paused ? "Pause beenden" : "Pause starten"}
                  </Button>
                </div>
              ))}
            </div>
          </section>
          <section className="admin-section" hidden>
            <h2>Ressourcengruppen</h2>
            {resourceGroups.map((group) => (
              <div className="resource-control" key={group.id}>
                <div>
                  <strong>{group.name}</strong>
                  <span>{group.status}</span>
                </div>
                <div className="secondary-actions">
                  <Button
                    busy={busyActionKey === `resource-${group.id}-paused`}
                    disabled={busyActionKey !== null}
                    onClick={() =>
                      runBusyAction(`resource-${group.id}-paused`, () =>
                        setResourceStatus(group.id, "PAUSED"),
                      )
                    }
                    type="button"
                  >
                    Pausieren
                  </Button>
                  <Button
                    busy={busyActionKey === `resource-${group.id}-interrupted`}
                    disabled={busyActionKey !== null}
                    onClick={() =>
                      runBusyAction(`resource-${group.id}-interrupted`, () =>
                        setResourceStatus(group.id, "INTERRUPTED"),
                      )
                    }
                    type="button"
                  >
                    Unterbrechen
                  </Button>
                  <Button
                    busy={busyActionKey === `resource-${group.id}-active`}
                    disabled={busyActionKey !== null}
                    onClick={() =>
                      runBusyAction(`resource-${group.id}-active`, () =>
                        setResourceStatus(group.id, "ACTIVE"),
                      )
                    }
                    type="button"
                  >
                    Aktivieren
                  </Button>
                  <Button
                    busy={busyActionKey === `resource-${group.id}-ended`}
                    disabled={group.status === "ENDED" || busyActionKey !== null}
                    onClick={() =>
                      runBusyAction(`resource-${group.id}-ended`, () =>
                        setResourceStatus(group.id, "ENDED"),
                      )
                    }
                    type="button"
                  >
                    Beenden
                  </Button>
                </div>
              </div>
            ))}
          </section>
          <section
            className="admin-section"
            hidden={adminArea !== "events" || eventStep !== "completion"}
          >
            <div className="section-heading">
              <h2>Audit und Tagesabschluss</h2>
              <div className="report-actions">
                <Button
                  busy={busyActionKey === "export-daily-csv"}
                  onClick={() => void runBusyAction("export-daily-csv", exportDailyReport)}
                  type="button"
                >
                  CSV-Tagesbericht
                </Button>
                <Button
                  busy={busyActionKey === "export-daily-pdf"}
                  onClick={() => void runBusyAction("export-daily-pdf", exportDailyPdf)}
                  type="button"
                >
                  PDF-Tagesbericht
                </Button>
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
            </div>
            <div className="history-tabs" role="tablist" aria-label="Verlaufsansicht">
              {(
                [
                  ["OPERATIONS", "Betriebshistorie"],
                  ["FORECASTS", "Prognosegüte"],
                  ["AUDIT", "Auditprotokoll"],
                ] as const
              ).map(([value, label]) => (
                <button
                  aria-selected={historyView === value}
                  className={historyView === value ? "active" : ""}
                  key={value}
                  onClick={() => {
                    setHistoryView(value);
                    setHistoryOffset(0);
                  }}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <fieldset className="history-filters">
              <legend>
                {historyView === "OPERATIONS"
                  ? "Betriebsdaten filtern"
                  : historyView === "FORECASTS"
                    ? "Prognosen filtern"
                    : "Audit-Ereignisse filtern"}
              </legend>
              <LocalizedDateTimeInput
                label="Von"
                labelContent={
                  <FieldGroupLabel
                    label="Von"
                    help="Optionaler Beginn des ausgewerteten Zeitraums."
                  />
                }
                value={historySince}
                onChange={setHistorySince}
              />
              <LocalizedDateTimeInput
                label="Bis"
                labelContent={
                  <FieldGroupLabel
                    label="Bis"
                    help="Optionales Ende des ausgewerteten Zeitraums."
                  />
                }
                value={historyUntil}
                onChange={setHistoryUntil}
              />
              {historyView === "AUDIT" ? (
                <>
                  <div className="field-control">
                    <FieldLabel
                      htmlFor="history-event-type"
                      label="Ereignistyp"
                      help="Technischer Audit-Ereignisname, beispielsweise TICKET_NO_SHOW. Leer zeigt alle Typen."
                    />
                    <input
                      id="history-event-type"
                      value={historyEventType}
                      onChange={(event) => setHistoryEventType(event.target.value)}
                      placeholder="z. B. TICKET_NO_SHOW"
                    />
                  </div>
                  <div className="field-control">
                    <FieldLabel
                      htmlFor="history-aggregate-type"
                      label="Bezugsart"
                      help="Art des betroffenen Objekts, beispielsweise ROTATION, TICKET oder PRODUCT."
                    />
                    <input
                      id="history-aggregate-type"
                      value={historyAggregateType}
                      onChange={(event) => setHistoryAggregateType(event.target.value)}
                      placeholder="z. B. ROTATION"
                    />
                  </div>
                  <div className="field-control">
                    <FieldLabel
                      htmlFor="history-aggregate-id"
                      label="Bezugs-ID"
                      help="Interne anonyme Kennung eines bestimmten Objekts zur gezielten Nachverfolgung."
                    />
                    <input
                      id="history-aggregate-id"
                      value={historyAggregateId}
                      onChange={(event) => setHistoryAggregateId(event.target.value)}
                      placeholder="interne ID"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="field-control">
                    <FieldLabel
                      htmlFor="history-aircraft"
                      label="Flugzeug"
                      help="Begrenzt Betriebs- oder Prognoseeinträge auf ein Flugzeug."
                    />
                    <select
                      id="history-aircraft"
                      value={historyAircraftId}
                      onChange={(event) => setHistoryAircraftId(event.target.value)}
                    >
                      <option value="">Alle</option>
                      {board?.aircraft.map((aircraft) => (
                        <option value={aircraft.id} key={aircraft.id}>
                          {aircraft.registration}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-control">
                    <FieldLabel
                      htmlFor="history-pilot"
                      label="Pilotencode"
                      help="Begrenzt die Ansicht auf einen anonymen operativen Pilotencode."
                    />
                    <select
                      id="history-pilot"
                      value={historyPilotId}
                      onChange={(event) => setHistoryPilotId(event.target.value)}
                    >
                      <option value="">Alle</option>
                      {board?.pilots.map((pilot) => (
                        <option value={pilot.id} key={pilot.id}>
                          {pilot.operationalCode}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-control">
                    <FieldLabel
                      htmlFor="history-rotation"
                      label="Umlauf-ID"
                      help="Interne Kennung eines konkreten Umlaufs; leer zeigt alle Umläufe."
                    />
                    <input
                      id="history-rotation"
                      value={historyRotationId}
                      onChange={(event) => setHistoryRotationId(event.target.value)}
                      placeholder="interne ID"
                    />
                  </div>
                  {historyView === "OPERATIONS" ? (
                    <>
                      <div className="field-control">
                        <FieldLabel
                          htmlFor="history-ticket-status"
                          label="Ticketstatus"
                          help="Filtert nach dem aktuellen oder protokollierten anonymen Ticketzustand."
                        />
                        <select
                          id="history-ticket-status"
                          value={historyTicketStatus}
                          onChange={(event) => setHistoryTicketStatus(event.target.value)}
                        >
                          <option value="">Alle</option>
                          {[
                            "QUEUED",
                            "CHECKED_IN",
                            "CALLED",
                            "BOARDING",
                            "IN_FLIGHT",
                            "LANDED",
                            "COMPLETED",
                            "NO_SHOW",
                            "CANCELED",
                            "CLARIFICATION",
                          ].map((status) => (
                            <option value={status} key={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field-control">
                        <FieldLabel
                          htmlFor="history-product"
                          label="Produkt"
                          help="Begrenzt die Betriebshistorie auf ein Produkt."
                        />
                        <select
                          id="history-product"
                          value={historyProductId}
                          onChange={(event) => setHistoryProductId(event.target.value)}
                        >
                          <option value="">Alle</option>
                          {board?.products.map((product) => (
                            <option value={product.id} key={product.id}>
                              {product.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field-control">
                        <FieldLabel
                          htmlFor="history-resource-group"
                          label="Ressourcengruppe"
                          help="Begrenzt die Betriebshistorie auf die gemeinsame operative Queue."
                        />
                        <select
                          id="history-resource-group"
                          value={historyResourceGroupId}
                          onChange={(event) => setHistoryResourceGroupId(event.target.value)}
                        >
                          <option value="">Alle</option>
                          {board?.resourceGroups.map((group) => (
                            <option value={group.id} key={group.id}>
                              {group.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field-control">
                        <FieldLabel
                          htmlFor="history-communication-number"
                          label="Fluggruppennummer"
                          help="Stabile öffentliche Kommunikationsnummer der Fluggruppe, keine garantierte Uhrzeit."
                        />
                        <input
                          id="history-communication-number"
                          min="1"
                          type="number"
                          value={historyCommunicationNumber}
                          onChange={(event) => setHistoryCommunicationNumber(event.target.value)}
                        />
                      </div>
                      <div className="field-control">
                        <FieldLabel
                          htmlFor="history-ticket-id"
                          label="Ticket-ID"
                          help="Interne anonyme Ticketkennung; nicht der öffentliche QR-Code."
                        />
                        <input
                          id="history-ticket-id"
                          value={historyTicketId}
                          onChange={(event) => setHistoryTicketId(event.target.value)}
                          placeholder="interne ID"
                        />
                      </div>
                      <div className="field-control">
                        <FieldLabel
                          htmlFor="history-ticket-group"
                          label="Ticketgruppe"
                          help="Interne anonyme Kennung einer gemeinsam gebuchten und untrennbaren Gruppe."
                        />
                        <input
                          id="history-ticket-group"
                          value={historyTicketGroupId}
                          onChange={(event) => setHistoryTicketGroupId(event.target.value)}
                          placeholder="interne ID"
                        />
                      </div>
                    </>
                  ) : null}
                </>
              )}
              <button
                onClick={() =>
                  historyView === "AUDIT" ? void refreshHistory() : void refreshDetailedHistory(0)
                }
                type="button"
              >
                Filter anwenden
              </button>
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
                          <code>{entry.ticketId}</code>
                          <small>
                            <code>{entry.ticketGroupId}</code>
                          </small>
                        </td>
                        <td>{entry.ticketStatus}</td>
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
                          <small>
                            <code>{entry.rotationId}</code>
                          </small>
                        </td>
                        <td>{entry.triggerEventType}</td>
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
                {history.entries.slice(0, 50).map((entry) => (
                  <div key={entry.sequence}>
                    <time dateTime={entry.occurredAt}>
                      {new Date(entry.occurredAt).toLocaleString("de-DE", {
                        timeZone: board?.event.timeZone ?? "Europe/Berlin",
                      })}
                    </time>
                    <strong>{entry.eventType}</strong>
                    <span>
                      {entry.aggregateType} · Version {entry.aggregateVersion}
                    </span>
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
          {factoryResetOpen ? (
            <div className="modal-backdrop factory-reset-backdrop">
              <form
                aria-labelledby="factory-reset-title"
                aria-modal="true"
                className="confirmation-dialog factory-reset-dialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  void performFactoryReset();
                }}
                role="dialog"
              >
                <div className="drawer-heading">
                  <div>
                    <h2 id="factory-reset-title">Werkszustand herstellen</h2>
                    <p>Diese Aktion kann nicht rückgängig gemacht werden.</p>
                  </div>
                  <button
                    aria-label="Werksreset schließen"
                    disabled={factoryResetBusy}
                    onClick={() => setFactoryResetOpen(false)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <div className="factory-delete-summary">
                  <strong>Wird gelöscht</strong>
                  <ul>
                    <li>Alle Tickets, Warteschlangen, Umläufe und Flugdaten</li>
                    <li>Alle Stammdaten und Veranstaltungsparameter</li>
                    <li>Alle Historien, Protokolle und Sitzungen</li>
                    <li>Die Ersteinrichtung</li>
                  </ul>
                </div>
                <div className="field-control">
                  <FieldLabel
                    htmlFor="factory-reset-reason"
                    label="Begründung"
                    help="Dokumentiert, warum der vollständige Werksreset ausgeführt wird."
                  />
                  <textarea
                    id="factory-reset-reason"
                    maxLength={240}
                    onChange={(event) => setFactoryResetReason(event.target.value)}
                    placeholder="Grund für den Werksreset"
                    value={factoryResetReason}
                  />
                </div>
                {session?.account.role !== "ADMIN" ? (
                  <div className="field-control">
                    <FieldLabel
                      htmlFor="factory-reset-pin"
                      label="Administrator-PIN"
                      help="Bestätigt die Berechtigung für diesen irreversiblen Vorgang. Die PIN wird nicht protokolliert."
                    />
                    <input
                      autoComplete="current-password"
                      id="factory-reset-pin"
                      onChange={(event) => setFactoryResetPin(event.target.value)}
                      type="password"
                      value={factoryResetPin}
                    />
                  </div>
                ) : null}
                <div className="field-control">
                  <FieldLabel
                    htmlFor="factory-reset-confirmation"
                    label="Sicherheitsbestätigung"
                    help="Zum Schutz vor versehentlicher Ausführung muss WERKSZUSTAND vollständig eingegeben werden."
                  />
                  <input
                    autoComplete="off"
                    id="factory-reset-confirmation"
                    onChange={(event) => setFactoryResetConfirmation(event.target.value)}
                    value={factoryResetConfirmation}
                  />
                </div>
                <label className="reset-checkbox">
                  <input
                    checked={retainRecoveryBackup}
                    onChange={(event) => {
                      setRetainRecoveryBackup(event.target.checked);
                      if (event.target.checked) setDeleteAllBackups(false);
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>Wiederherstellungssicherung in R2 behalten</strong>
                    <small>Empfohlen – ermöglicht eine spätere Wiederherstellung.</small>
                  </span>
                </label>
                <label className="reset-checkbox extra-danger">
                  <input
                    checked={deleteAllBackups}
                    onChange={(event) => {
                      setDeleteAllBackups(event.target.checked);
                      if (event.target.checked) setRetainRecoveryBackup(false);
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>Auch alle R2-Sicherungen endgültig löschen</strong>
                    <small>Diese Aktion kann nicht rückgängig gemacht werden.</small>
                  </span>
                </label>
                <p className="reset-consequence">
                  Nach erfolgreichem Reset werden lokale Zugangsdaten entfernt und /setup geöffnet.
                </p>
                {factoryResetError ? (
                  <ValidationHint tone="error">{factoryResetError}</ValidationHint>
                ) : null}
                <div className="dialog-actions">
                  <button
                    disabled={factoryResetBusy}
                    onClick={() => setFactoryResetOpen(false)}
                    type="button"
                  >
                    Abbrechen
                  </button>
                  <Button
                    busy={factoryResetBusy}
                    className="danger-action"
                    disabled={
                      factoryResetReason.trim().length < 3 ||
                      factoryResetPin.length < 4 ||
                      factoryResetConfirmation !== "WERKSZUSTAND"
                    }
                    onClick={() => void performFactoryReset()}
                    type="button"
                    variant="danger"
                  >
                    Alles löschen und neu starten
                  </Button>
                </div>
              </form>
            </div>
          ) : null}
          </div>
        </div>
      </section>
    </Shell>
  );
}
