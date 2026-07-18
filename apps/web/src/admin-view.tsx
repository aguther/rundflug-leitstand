import type {
  AuditHistory,
  EventCatalogEntry,
  ForecastHistory,
  OperationalHistory,
  OperationBoard,
} from "@rundflug/contracts";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  manifestCorrectionCandidates,
  manifestCorrectionTargets,
} from "./admin-manifest-correction";
import {
  type AdminArea,
  AdminNavigation,
  type MasterDataCategory,
  MasterDataNavigation,
  SetupProgress,
  type SetupStep,
  ValidationHint,
} from "./admin-ux";
import type { PairedDeviceSummary } from "./api";
import {
  cloneEvent,
  deleteEvent,
  downloadDailyPdf,
  downloadDailyReport,
  downloadPerformanceProfile,
  downloadTicketRawData,
  factoryReset,
  getAuditHistory,
  getEventCatalog,
  getForecastHistory,
  getOperationalHistory,
  getPairedDevices,
  getPushConfiguration,
  getSetupStatus,
  recoverAdminDevice,
  removeEventLogo,
  sendCommand,
  uploadEventLogo,
  verifyAdminPin,
} from "./api";
import { AppShell as Shell } from "./app/AppShell";
import { isDeviceAuthorizationError } from "./board-sync";
import { rememberDeviceCredential } from "./device-credentials";
import { forgetActiveEvent, rememberActiveEvent } from "./event-context";
import { eventLocalDateTimeToIso, formatEventLocalDateTime } from "./event-time";
import { AccountManagement } from "./features/auth/AccountManagement";
import { useAuth } from "./features/auth/AuthContext";
import { LocalizedDateInput, LocalizedDateTimeInput } from "./localized-date-input";
import { clearOfflineOperationBoards } from "./offline-store";
import {
  ADMIN_CONFIGURATION_AUDIT_REASON,
  ADMIN_DEVICE_ID,
  aircraftStateLabel,
  ConnectionNotice,
  capacityLabel,
  createDeviceToken,
  deviceTokenFor,
  EmergencyNotice,
  EVENT_ID,
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
  sha256HexBrowser,
  useOperationBoard,
} from "./operation-workspace";
import {
  formatEuroInput,
  parseEuroToCents,
  productPositionOptions,
  setWeightCaptureMode,
  toggleWeightClass,
  weightCaptureEnabled,
  weightClassesForChildCompanion,
} from "./product-editor";

export function AdminView() {
  const { session, logout } = useAuth();
  const { board, error, lastConfirmedAt, refresh, refreshing } = useOperationBoard(ADMIN_DEVICE_ID);
  const initialAdminParams = useRef(new URLSearchParams(window.location.search)).current;
  const [adminArea, setAdminArea] = useState<AdminArea>(() => {
    const requestedArea = initialAdminParams.get("area");
    const validAreas: AdminArea[] = [
      "overview",
      "setup",
      "master-data",
      "users",
      "evaluation",
      "audit",
      "backup",
    ];
    return (validAreas as string[]).includes(requestedArea ?? "")
      ? (requestedArea as AdminArea)
      : "overview";
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
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("area", adminArea);
    if (adminArea === "master-data") url.searchParams.set("section", masterDataCategory);
    else url.searchParams.delete("section");
    window.history.replaceState(null, "", url);
  }, [adminArea, masterDataCategory]);
  const [reason, setReason] = useState("");
  const [adminPin, setAdminPinState] = useState(session?.account.role === "ADMIN" ? "000000" : "");
  const adminPinRef = useRef(session?.account.role === "ADMIN" ? "000000" : "");
  const setAdminPin = useCallback((value: string) => {
    adminPinRef.current = value;
    setAdminPinState(value);
  }, []);
  const [adminModeUnlocked, setAdminModeUnlocked] = useState(session?.account.role === "ADMIN");
  const [adminPinDialog, setAdminPinDialog] = useState<"unlock" | "action" | "recover" | null>(
    null,
  );
  const [adminPinError, setAdminPinError] = useState<string | null>(null);
  const [adminPinBusy, setAdminPinBusy] = useState(false);
  const pendingAdminActionRef = useRef<(() => Promise<void>) | null>(null);
  const adminPinInputRef = useRef<HTMLInputElement>(null);
  const [masterEditorOpen, setMasterEditorOpen] = useState(false);
  const initialMasterSelectionRef = useRef(false);
  const [masterSubmitAttempted, setMasterSubmitAttempted] = useState(false);
  const [masterSearch, setMasterSearch] = useState("");
  const [masterPage, setMasterPage] = useState(0);
  const [masterPageSize, setMasterPageSize] = useState(10);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing a filter or page size intentionally resets pagination
  useEffect(() => {
    setMasterPage(0);
  }, [masterDataCategory, masterSearch, masterPageSize]);
  const [pendingMasterDelete, setPendingMasterDelete] = useState<MasterDataDeleteTarget | null>(
    null,
  );
  const [saleClosesAt, setSaleClosesAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
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
  const [devices, setDevices] = useState<PairedDeviceSummary[]>([]);
  const [deviceLabel, setDeviceLabel] = useState("Kasse 2");
  const [deviceRole, setDeviceRole] = useState<
    "CASHIER" | "FLIGHT_LINE" | "FLIGHT_DIRECTOR" | "ADMIN"
  >("CASHIER");
  const [pairingQr, setPairingQr] = useState<string | null>(null);
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
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
  const [eventLogoFile, setEventLogoFile] = useState<File | null>(null);
  const [pushConfigurationStatus, setPushConfigurationStatus] = useState<
    "loading" | "configured" | "missing" | "unavailable"
  >("loading");
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(null), 6_000);
    return () => window.clearTimeout(timeout);
  }, [message]);
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
  const [events, setEvents] = useState<EventCatalogEntry[]>([]);
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
  const deviceAuthorizationRejected = isDeviceAuthorizationError(error);
  const productPriceCents = parseEuroToCents(productPriceInput);
  const manifestCandidates = manifestCorrectionCandidates(board?.rotations ?? []);
  const selectedManifestCandidate = manifestCandidates.find(
    (candidate) => candidate.ticketGroupId === manifestTicketGroupId,
  );
  const manifestTargets = manifestCorrectionTargets(
    board?.rotations ?? [],
    selectedManifestCandidate,
  );

  useEffect(() => {
    if (initialMasterSelectionRef.current || adminArea !== "master-data" || !board) return;
    initialMasterSelectionRef.current = true;
    const entry = board.resourceGroups[0];
    setResourceEditorId(entry?.id ?? "new");
    setResourceName(entry?.name ?? "");
    setResourceGateId(entry?.gateId ?? board.gates.find((gate) => gate.active)?.id ?? "");
    setResourcePlannedMinutes(entry?.plannedRotationMinutes ?? 30);
    setResourceAutomaticPrecall(entry?.automaticPrecallEnabled ?? true);
    setResourceAircraftIds(entry?.activeAircraftIds ?? []);
  }, [adminArea, board]);

  useEffect(() => {
    if (!adminPinDialog && (!pendingMasterDelete || adminModeUnlocked)) return;
    const frame = window.requestAnimationFrame(() => adminPinInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [adminModeUnlocked, adminPinDialog, pendingMasterDelete]);

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
  const refreshDevices = useCallback(async () => {
    try {
      setDevices(
        await getPairedDevices(EVENT_ID, ADMIN_DEVICE_ID, deviceTokenFor(ADMIN_DEVICE_ID)),
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Geräteübersicht nicht verfügbar.");
    }
  }, []);
  useEffect(() => {
    void refreshHistory();
    if (historyView !== "AUDIT") void refreshDetailedHistory(0);
    if (isAdministrator) void refreshDevices();
  }, [historyView, isAdministrator, refreshDevices, refreshDetailedHistory, refreshHistory]);
  useEffect(() => {
    if (adminArea === "audit") setHistoryView("AUDIT");
    if (adminArea === "evaluation" && historyView === "AUDIT") setHistoryView("OPERATIONS");
  }, [adminArea, historyView]);
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
      rememberDeviceCredential(window.localStorage, "ADMIN", result.adminDeviceId, adminToken);
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

  function requestAdminAction(action: () => Promise<void>) {
    if (!isAdministrator) {
      setMessage("Für diese Änderung wird ein Administrationsgerät benötigt.");
      return;
    }
    if (
      session?.account.role === "ADMIN" ||
      (adminModeUnlocked && adminPinRef.current.length >= 4)
    ) {
      void action();
      return;
    }
    pendingAdminActionRef.current = action;
    setAdminPin("");
    setAdminPinError(null);
    setAdminPinDialog("action");
  }

  function requestAdminModeUnlock() {
    if (!isAdministrator) {
      setMessage("Der Bearbeitungsmodus ist nur auf einem Administrationsgerät verfügbar.");
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

  function requestAdminDeviceRecovery() {
    pendingAdminActionRef.current = null;
    setAdminPin("");
    setAdminPinError(null);
    setAdminPinDialog("recover");
  }

  async function confirmAdminPinDialog() {
    if (!adminPinDialog || adminPinBusy || adminPin.length < 4) return;
    setAdminPinBusy(true);
    setAdminPinError(null);
    try {
      if (adminPinDialog === "recover") {
        const recoveredDeviceId = ADMIN_DEVICE_ID.startsWith("unpaired-")
          ? crypto.randomUUID()
          : ADMIN_DEVICE_ID;
        const token = createDeviceToken();
        const result = await recoverAdminDevice(
          EVENT_ID,
          recoveredDeviceId,
          adminPin,
          await sha256HexBrowser(token),
        );
        rememberDeviceCredential(window.localStorage, "ADMIN", result.adminDeviceId, token);
        rememberActiveEvent(window.localStorage, result.eventId);
        setAdminPinDialog(null);
        setAdminPin("");
        window.location.reload();
        return;
      }
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

  async function pairDevice() {
    if (!board || deviceLabel.trim().length < 2 || adminPinRef.current.length < 4) return;
    const pairedDeviceId = crypto.randomUUID();
    const token = createDeviceToken();
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "PAIR_DEVICE",
          payload: {
            pairedDeviceId,
            label: deviceLabel.trim(),
            role: deviceRole,
            credentialHash: await sha256HexBrowser(token),
            adminPin: adminPinRef.current,
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      const params = new URLSearchParams({
        device: pairedDeviceId,
        token,
        role: deviceRole,
        event: EVENT_ID,
      });
      const url = `${window.location.origin}/pair#${params.toString()}`;
      setPairingUrl(url);
      setPairingQr(
        await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 320 }),
      );
      setMessage("Kopplung erstellt. QR-Code nur am vorgesehenen Gerät scannen.");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshDevices();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Gerätekopplung fehlgeschlagen.");
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

  async function saveEventLogo() {
    if (!board || !eventLogoFile) return;
    try {
      await uploadEventLogo(
        EVENT_ID,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        board.event.version,
        eventLogoFile,
      );
      setEventLogoFile(null);
      setMessage("Veranstaltungslogo gespeichert. Die Ansichten verwenden es nach dem Neuladen.");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Logo konnte nicht gespeichert werden.");
    }
  }

  async function clearEventLogo() {
    if (!board) return;
    try {
      await removeEventLogo(
        EVENT_ID,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        board.event.version,
      );
      setMessage("Veranstaltungslogo entfernt. Das Flugzeugsymbol wird wieder verwendet.");
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Logo konnte nicht entfernt werden.");
    }
  }

  function selectProductForEditing(id: string) {
    setMasterEditorOpen(true);
    setMasterSubmitAttempted(false);
    setProductEditorId(id);
    const entry = board?.products.find((product) => product.id === id);
    setProductName(entry?.name ?? "");
    setProductCode(entry?.code ?? "");
    setProductDescription(entry?.publicDescription ?? "");
    setProductResourceGroupId(entry?.resourceGroupId ?? resourceGroups[0]?.id ?? "");
    setProductGateId(entry?.gateId ?? board?.gates.find((gate) => gate.active)?.id ?? "");
    setProductPriceInput(formatEuroInput(entry?.priceCents ?? 0));
    setProductReferenceDuration(entry?.referenceDurationMinutes ?? 20);
    setProductPromisedFlightMinutes(entry?.promisedFlightMinutes ?? 20);
    setProductChildCompanion(entry?.childCompanionRequired ?? false);
    setProductWeightClasses(entry?.weightClasses ?? ["NOT_CAPTURED"]);
    setProductSortOrder(entry?.sortOrder ?? 10);
  }

  function selectGateForEditing(id: string) {
    setMasterEditorOpen(true);
    setMasterSubmitAttempted(false);
    setGateEditorId(id);
    const entry = board?.gates.find((gate) => gate.id === id);
    setGateLabel(entry?.label ?? "");
    setGateType(entry?.gateType ?? "FLIGHT_LINE");
    setGateActive(entry?.active ?? true);
    setGateSortOrder(entry?.sortOrder ?? 10);
    setGateDisplayProductIds(entry?.displayFilter.productIds ?? []);
    setGateDisplayRotationStatuses(entry?.displayFilter.rotationStatuses ?? []);
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
      setMasterEditorOpen(false);
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
      productWeightClasses.length === 0 ||
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
      setMasterEditorOpen(false);
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Produkt konnte nicht gespeichert werden.",
      );
    }
  }

  function selectResourceForEditing(id: string) {
    setMasterEditorOpen(true);
    setMasterSubmitAttempted(false);
    setResourceEditorId(id);
    const entry = resourceGroups.find((group) => group.id === id);
    setResourceName(entry?.name ?? "");
    setResourceGateId(entry?.gateId ?? board?.gates.find((gate) => gate.active)?.id ?? "");
    setResourcePlannedMinutes(entry?.plannedRotationMinutes ?? 30);
    setResourceAutomaticPrecall(entry?.automaticPrecallEnabled ?? true);
    setResourceAircraftIds(entry?.activeAircraftIds ?? []);
  }

  function selectAircraftForEditing(id: string) {
    setMasterEditorOpen(true);
    setMasterSubmitAttempted(false);
    setAircraftEditorId(id);
    const entry = board?.aircraft.find((aircraft) => aircraft.id === id);
    setAircraftRegistration(entry?.registration ?? "");
    setAircraftType(entry?.aircraftType ?? "");
    setAircraftSeats(entry?.passengerSeats ?? 3);
    setAircraftMaximumPayload(entry?.maximumPassengerPayloadKg?.toString() ?? "");
  }

  async function saveResourceGroup() {
    if (
      !board ||
      !resourceGateId ||
      resourceName.trim().length < 2 ||
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
      setMasterEditorOpen(false);
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
      setMasterEditorOpen(false);
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
      setMasterEditorOpen(false);
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Flugzeugzuordnung konnte nicht geändert werden.",
      );
    }
  }

  async function revokeDevice(device: PairedDeviceSummary) {
    if (!board || reason.trim().length < 3 || adminPinRef.current.length < 4) return;
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: ADMIN_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "REVOKE_DEVICE",
          payload: {
            pairedDeviceId: device.id,
            adminPin: adminPinRef.current,
            reason: reason.trim(),
          },
        },
        deviceTokenFor(ADMIN_DEVICE_ID),
      );
      setMessage("Gerätekopplung wurde sofort widerrufen.");
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshDevices();
      await refreshHistory();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Widerruf fehlgeschlagen.");
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
      setMasterEditorOpen(false);
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Pilotencode konnte nicht geändert werden.",
      );
    }
  }

  function selectPilotForEditing(id: string) {
    setMasterEditorOpen(true);
    setMasterSubmitAttempted(false);
    setPilotEditorId(id);
    const entry = board?.pilots.find((pilot) => pilot.id === id);
    setPilotCode(entry?.operationalCode ?? "P-01");
    setPilotNote(entry?.operationalNote ?? "");
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
  ) {
    setMasterSubmitAttempted(true);
    if (!isAdministrator) {
      setMessage("Für Stammdatenänderungen wird ein Administrationsgerät benötigt.");
      return;
    }
    if (!valid) return;
    requestAdminAction(async () => {
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
    });
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
                : productWeightClasses.length === 0
                  ? "product-weight-capture"
                  : productChildCompanion && !productWeightClasses.includes("CHILD")
                    ? "product-child-companion"
                    : null;
    if (invalidFieldId) {
      window.requestAnimationFrame(() => document.getElementById(invalidFieldId)?.focus());
      return;
    }
    requestMasterSave("product", true);
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
      id: "parameters",
      label: "Veranstaltung",
      complete: Boolean(board?.event.saleOpensAt && board.event.operationsEndAt),
      area: "setup",
    },
    {
      id: "gates",
      label: "Gates",
      complete: Boolean(board?.gates.some((gate) => gate.active)),
      area: "master-data",
      category: "gates",
    },
    {
      id: "aircraft",
      label: "Flugzeuge",
      complete: Boolean(board?.aircraft.length),
      area: "master-data",
      category: "aircraft",
    },
    {
      id: "resource-groups",
      label: "Ressourcengruppen",
      complete: Boolean(
        board?.resourceGroups.length &&
          board.resourceGroups.every((group) => group.activeAircraftIds.length > 0),
      ),
      area: "master-data",
      category: "resource-groups",
    },
    {
      id: "pilots",
      label: "Piloten",
      complete: Boolean(board?.pilots.some((pilot) => pilot.active)),
      area: "master-data",
      category: "pilots",
    },
    {
      id: "products",
      label: "Produkte",
      complete: Boolean(board?.products.length),
      area: "master-data",
      category: "products",
    },
    {
      id: "activation",
      label: "Betriebsfreigabe",
      complete: Boolean(board && board.event.status !== "PREPARATION"),
      area: "setup",
    },
  ];
  const adminAreaCopy: Record<AdminArea, { title: string; description: string }> = {
    overview: {
      title: "Übersicht",
      description: "Betriebsstatus, Kennzahlen und offene organisatorische Aufgaben.",
    },
    setup: {
      title: "Veranstaltung",
      description: "Das System Schritt für Schritt für den Rundflugbetrieb vorbereiten.",
    },
    "master-data": {
      title: "Stammdaten",
      description: "Ressourcen für den Flugtag verwalten.",
    },
    users: {
      title: "Konten",
      description: "Pseudonyme Arbeitskonten, Rollen und Sitzungen verwalten.",
    },
    evaluation: {
      title: "Auswertung",
      description: "Verläufe, Berichte und seltene administrative Sonderfälle prüfen.",
    },
    audit: {
      title: "Audit",
      description: "Nachvollziehbare operative und administrative Änderungen prüfen.",
    },
    backup: {
      title: "Sicherung & Reset",
      description: "Daten gezielt bereinigen oder das System vollständig neu einrichten.",
    },
  };

  function openSetupStep(step: SetupStep) {
    setAdminArea(step.area);
    if (step.category) setMasterDataCategory(step.category);
  }

  function startNewMasterDataEntry() {
    if (masterDataCategory === "gates") selectGateForEditing("new");
    if (masterDataCategory === "resource-groups") selectResourceForEditing("new");
    if (masterDataCategory === "aircraft") selectAircraftForEditing("new");
    if (masterDataCategory === "assignments") {
      setAssignmentAircraftId(board?.aircraft[0]?.id ?? "");
      setAssignmentResourceGroupId(board?.aircraft[0]?.resourceGroupId ?? "");
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
      setMasterEditorOpen(false);
      if (!adminModeUnlocked) setAdminPin("");
      await refresh();
      await refreshHistory();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Stammdatensatz konnte nicht gelöscht werden.",
      );
    }
  }

  const masterDataCounts: Record<MasterDataCategory, number> = {
    gates: board?.gates.length ?? 0,
    "resource-groups": resourceGroups.length,
    aircraft: board?.aircraft.length ?? 0,
    assignments: board?.aircraft.filter((aircraft) => aircraft.resourceGroupId).length ?? 0,
    pilots: board?.pilots.length ?? 0,
    products: board?.products.length ?? 0,
  };
  const normalizedMasterSearch = masterSearch.trim().toLocaleLowerCase("de-DE");
  const visibleGates = (board?.gates ?? []).filter((gate) =>
    `${gate.label} ${gate.gateType}`.toLocaleLowerCase("de-DE").includes(normalizedMasterSearch),
  );
  const visibleResourceGroups = resourceGroups.filter((group) =>
    `${group.name} ${group.gateLabel}`.toLocaleLowerCase("de-DE").includes(normalizedMasterSearch),
  );
  const visibleAircraft = (board?.aircraft ?? []).filter((aircraft) =>
    `${aircraft.registration} ${aircraft.aircraftType} ${aircraft.resourceGroupName}`
      .toLocaleLowerCase("de-DE")
      .includes(normalizedMasterSearch),
  );
  const visiblePilots = (board?.pilots ?? []).filter((pilot) =>
    `${pilot.operationalCode} ${pilot.operationalNote}`
      .toLocaleLowerCase("de-DE")
      .includes(normalizedMasterSearch),
  );
  const visibleProducts = (board?.products ?? []).filter((product) =>
    `${product.code} ${product.name} ${product.resourceGroupName} ${product.gateLabel}`
      .toLocaleLowerCase("de-DE")
      .includes(normalizedMasterSearch),
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
  const masterDataSectionLabel: Record<MasterDataCategory, string> = {
    gates: "Gates",
    "resource-groups": "Ressourcengruppen",
    aircraft: "Flugzeuge",
    assignments: "Zuordnungen",
    pilots: "Pilotencodes",
    products: "Produkte",
  };

  return (
    <Shell className="admin-shell" title="Administration">
      <ConnectionNotice error={error} lastConfirmedAt={lastConfirmedAt} />
      {setupRequired ? (
        <div className="connection-warning" role="status">
          Dieses System ist noch nicht eingerichtet. <a href="/setup">Ersteinrichtung öffnen</a>
        </div>
      ) : null}
      <EmergencyNotice active={board?.event.emergencyMode ?? false} />
      <InterruptionNotice active={board?.event.operationalInterrupted ?? false} />
      <OperationalNotice note={board?.event.operationalNote} />
      <section className="admin-layout">
        <AdminNavigation activeArea={adminArea} onChange={setAdminArea} />
        <div
          className={`admin-workspace ${adminArea === "master-data" ? `master-data-active ${masterEditorOpen ? "editor-open" : "editor-closed"}` : ""}`}
        >
          {adminArea !== "master-data" ? (
            <header className="admin-page-header">
              <div>
                <h1>{adminAreaCopy[adminArea].title}</h1>
                <p>{adminAreaCopy[adminArea].description}</p>
              </div>
              <span className={`event-phase ${board?.event.status.toLowerCase() ?? "unknown"}`}>
                {board?.event.status === "ACTIVE"
                  ? "Betrieb aktiv"
                  : board?.event.status === "PREPARATION"
                    ? "Betrieb noch nicht freigegeben"
                    : board?.event.status === "CLOSED"
                      ? "Betrieb geschlossen"
                      : error
                        ? "Stand nicht verfügbar"
                        : "Stand wird geladen"}
              </span>
            </header>
          ) : null}
          {adminArea === "setup" ? (
            <SetupProgress onSelect={openSetupStep} steps={setupSteps} />
          ) : null}
          {board?.currentDeviceRole === "FLIGHT_DIRECTOR" ? (
            <div className="readonly-banner">Flugleitungsansicht · primär lesend</div>
          ) : null}
          {board ? (
            <>
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
                  <span>Geräte online</span>
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
                  ? `${session.account.loginCode} · Änderungen werden dem angemeldeten Konto und diesem Gerät zugeordnet.`
                  : adminModeUnlocked
                    ? "Mehrere Änderungen sind möglich. Jede Änderung wird weiterhin einzeln protokolliert."
                    : "Änderungen fragen die PIN einzeln ab oder können für diese Arbeitssitzung entsperrt werden."}
              </span>
            </div>
            {isAdministrator ? (
              <button
                className="secondary-action"
                onClick={() => {
                  if (session?.account.role === "ADMIN") {
                    void logout().then(() => window.location.reload());
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
              </button>
            ) : (
              <div className="secondary-actions admin-recovery-actions">
                <button
                  aria-busy={refreshing}
                  className="secondary-action"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                  type="button"
                >
                  {refreshing ? "Betriebsstand wird geladen …" : "Erneut laden"}
                </button>
                <button
                  className="secondary-action"
                  disabled={refreshing}
                  onClick={requestAdminDeviceRecovery}
                  type="button"
                >
                  Mit PIN anmelden
                </button>
              </div>
            )}
            {!isAdministrator ? (
              deviceAuthorizationRejected ? (
                <ValidationHint tone="error">
                  Dieses Browsergerät wurde nicht als Administration bestätigt. Mit der
                  Administrator-PIN kann der Zugang auf diesem Gerät sicher erneuert werden.
                </ValidationHint>
              ) : error ? (
                <ValidationHint tone="error">
                  Der Betriebsstand konnte nicht geladen werden. Erneut laden oder mit der
                  Administrator-PIN anmelden; vorhandene Betriebsdaten bleiben unverändert.
                </ValidationHint>
              ) : (
                <ValidationHint>Gerätebindung und Betriebsstand werden geprüft.</ValidationHint>
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
          {adminArea === "master-data" ? (
            <header className="master-data-heading">
              <h1>
                Stammdaten <span aria-hidden="true">›</span>{" "}
                <strong>{masterDataSectionLabel[masterDataCategory]}</strong>
              </h1>
            </header>
          ) : null}
          {adminArea === "users" ? <AccountManagement /> : null}
          <section
            className="reset-levels"
            hidden={adminArea !== "setup" && adminArea !== "backup"}
          >
            {!isAdministrator ? (
              <ValidationHint tone="error">
                Reset ist sichtbar, bleibt aber gesperrt, bis dieses Administrationsgerät vom Server
                bestätigt wurde.
              </ValidationHint>
            ) : null}
            <div className="reset-level-row" hidden={adminArea !== "setup"}>
              <div>
                <h2>Betriebsdaten zurücksetzen</h2>
                <p>
                  Einen neuen, leeren Betriebsstand mit bestehenden Stammdaten anlegen. Der
                  bisherige Stand kann nach dem Export vollständig gelöscht werden.
                </p>
              </div>
              <button
                disabled={!isAdministrator}
                onClick={() => {
                  setRestartMode("KEEP_MASTER_DATA");
                  setRestartConfirmation("");
                  setRestartEditorOpen(true);
                }}
                type="button"
              >
                Betriebsdaten zurücksetzen
              </button>
            </div>
            <div className="reset-level-row" hidden={adminArea !== "setup"}>
              <div>
                <h2>Neue Veranstaltung beginnen</h2>
                <p>
                  Einen neuen Veranstaltungstag ohne bestehende Gates, Ressourcen, Flugzeuge,
                  Pilotencodes oder Produkte beginnen.
                </p>
              </div>
              <button
                disabled={!isAdministrator}
                onClick={() => {
                  setRestartMode("EMPTY");
                  setRestartConfirmation("");
                  setRestartEditorOpen(true);
                }}
                type="button"
              >
                Neue Veranstaltung
              </button>
            </div>
            <div className="reset-level-row factory-reset-row" hidden={adminArea !== "backup"}>
              <div>
                <h2>Werkszustand herstellen</h2>
                <p>
                  Alle Anwendungsdaten, Stammdaten, Historien, Gerätebindungen und die
                  Ersteinrichtung werden gelöscht. Danach startet das System wieder bei /setup.
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
            hidden={adminArea !== "setup" || !restartEditorOpen}
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
            <div className="event-catalog">
              {events.map((entry) => (
                <div className="event-catalog-entry" key={entry.eventId}>
                  <a
                    className={entry.eventId === EVENT_ID ? "current-event" : ""}
                    href={`/admin?event=${encodeURIComponent(entry.eventId)}`}
                  >
                    <strong>{entry.name}</strong>
                    <span>
                      {entry.eventDate} · {entry.aerodrome || "Flugplatz offen"}
                    </span>
                  </a>
                  <button
                    className="danger-link-action"
                    onClick={() => void removeEvent(entry.eventId, entry.name)}
                    type="button"
                  >
                    Löschen
                  </button>
                </div>
              ))}
            </div>
            <div className="parameter-grid">
              <label>
                <FieldLabel
                  label="Neustart-Stufe"
                  help="Bestimmt, ob Stammdaten übernommen werden oder die neue Veranstaltung vollständig leer beginnt."
                />
                <select
                  value={restartMode}
                  onChange={(event) =>
                    setRestartMode(event.target.value as "KEEP_MASTER_DATA" | "EMPTY")
                  }
                >
                  <option value="KEEP_MASTER_DATA">Betriebsdaten zurücksetzen</option>
                  <option value="EMPTY">Vollständig neu einrichten</option>
                </select>
              </label>
              <label>
                <FieldLabel
                  label="Technische ID"
                  help="Eindeutige, URL-taugliche Kennung der neuen Veranstaltung; zum Beispiel rundflug-2027."
                />
                <input
                  value={newEventId}
                  onChange={(event) => setNewEventId(event.target.value)}
                  placeholder="rundflug-2027"
                />
              </label>
              <label>
                <FieldLabel
                  label="Bezeichnung"
                  help="Lesbarer Veranstaltungsname für Administration, Kasse und Anzeigen."
                />
                <input
                  value={newEventName}
                  onChange={(event) => setNewEventName(event.target.value)}
                  placeholder="Flugtag 2027"
                />
              </label>
              <LocalizedDateInput
                label="Datum"
                labelContent={
                  <FieldLabel
                    label="Datum"
                    help="Veranstaltungstag im deutschen Format TT.MM.JJJJ."
                  />
                }
                value={newEventDate}
                onChange={setNewEventDate}
              />
              <label>
                <FieldLabel
                  label="Flugplatz"
                  help="Kurze Flugplatzkennung oder Ortsangabe für die Veranstaltung."
                />
                <input
                  value={newEventAerodrome}
                  onChange={(event) => setNewEventAerodrome(event.target.value)}
                  placeholder="EDXX"
                />
              </label>
              <label>
                <FieldLabel
                  label="Bestätigung"
                  help="Schutz vor versehentlichem Neustart. Zur Ausführung muss NEUSTART eingegeben werden."
                />
                <input
                  value={restartConfirmation}
                  onChange={(event) => setRestartConfirmation(event.target.value)}
                  placeholder="NEUSTART"
                  autoComplete="off"
                />
              </label>
            </div>
            <p className="help-text">
              {restartMode === "KEEP_MASTER_DATA"
                ? "Übernommen werden Parameter, Gates, Ressourcengruppen, Produkte, Flugzeugzuordnungen und Piloten-IDs. Tickets, Gruppen, Umläufe und Flugdaten beginnen leer; Verkäufe bleiben zunächst gesperrt."
                : "Nur Veranstaltungsdaten, Grundeinstellungen und dieses Administrationsgerät werden angelegt. Gates, Ressourcengruppen, Produkte, Flugzeugzuordnungen, Piloten-IDs und alle Betriebsdaten beginnen leer."}
            </p>
            <button
              type="button"
              disabled={
                !isAdministrator ||
                restartConfirmation !== "NEUSTART" ||
                newEventId.trim().length < 3 ||
                newEventName.trim().length < 3 ||
                !newEventDate ||
                newEventAerodrome.trim().length < 2
              }
              onClick={() => void createEventFromTemplate()}
            >
              Sicheren Neustart anlegen
            </button>
          </section>
          <section className="admin-section" hidden={adminArea !== "setup"}>
            <div className="parameter-section-heading">
              <h2>Veranstaltungsparameter</h2>
              <button
                className="primary-action parameter-save-action"
                disabled={!isAdministrator || !operationsEndAt}
                onClick={() => requestAdminAction(saveEventParameters)}
                type="button"
              >
                Veranstaltungsparameter speichern
              </button>
            </div>
            <div className="event-logo-editor">
              <label>
                <FieldLabel
                  label="Veranstaltungslogo"
                  help="PNG, JPEG, WebP oder sicheres SVG bis 1 MiB. Ohne Logo erscheint das Flugzeugsymbol."
                />
                <input
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(event) => setEventLogoFile(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>
              <button
                disabled={!eventLogoFile || !isAdministrator}
                onClick={() => requestAdminAction(saveEventLogo)}
                type="button"
              >
                Logo hochladen
              </button>
              <button
                className="danger-link-action"
                disabled={!isAdministrator}
                onClick={() => requestAdminAction(clearEventLogo)}
                type="button"
              >
                Logo entfernen
              </button>
            </div>
            <div className="parameter-grid">
              <LocalizedDateTimeInput
                label="Verkaufsbeginn"
                labelContent={
                  <FieldLabel
                    label="Verkaufsbeginn"
                    help="Lokaler Zeitpunkt, ab dem Tickets verkauft werden dürfen. Eingabe im deutschen Datum und 24-Stunden-Format."
                  />
                }
                value={saleOpensAt}
                onChange={setSaleOpensAt}
              />
              <LocalizedDateTimeInput
                label="Betriebsende"
                labelContent={
                  <FieldLabel
                    label="Betriebsende"
                    help="Geplantes lokales Ende des Rundflugbetriebs; Grundlage für Verkaufs- und Kapazitätsgrenzen."
                  />
                }
                value={operationsEndAt}
                onChange={setOperationsEndAt}
              />
              <label>
                <FieldLabel
                  label="No-Show nach Minuten"
                  help="Frühester Zeitpunkt nach dem Aufruf, ab dem fehlende Tickets manuell als No-Show behandelt werden dürfen."
                />
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={noShowAfterMinutes}
                  onChange={(event) => setNoShowAfterMinutes(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Klärung Kasse nach Zurückstellungen"
                  help="Nach dieser Anzahl manueller Zurückstellungen wird die Gruppe zur Klärung an der Kasse markiert."
                />
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={maxTicketDeferrals}
                  onChange={(event) => setMaxTicketDeferrals(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Benachrichtigungsvorlauf (Min.)"
                  help="Bestimmt, wie früh ein freiwilliger Web-Push zur Vorbereitung ausgelöst werden kann."
                />
                <input
                  type="number"
                  min="1"
                  max="240"
                  value={notificationLeadMinutes}
                  onChange={(event) => setNotificationLeadMinutes(Number(event.target.value))}
                />
              </label>
              <label className="admin-check-row">
                <input
                  checked={automaticPrecallEnabled}
                  onChange={(event) => setAutomaticPrecallEnabled(event.target.checked)}
                  type="checkbox"
                />
                <FieldLabel
                  label="Gruppen automatisch zum Gate voraufrufen"
                  help="Ruft nur die nächste passende Gruppe anhand der Prognose zum Gate. Das bindet kein Flugzeug und ersetzt nicht die Bestätigung durch die Flight Line."
                />
              </label>
              <div className="admin-info-note">
                <strong>Adaptiver Voraufruf</strong>
                <p>
                  Das System lernt den passenden Vorlauf während des Veranstaltungstags aus den
                  tatsächlichen Boarding- und Gate-Wartezeiten. Die Wartezeit am Gate ist ein
                  weiches Optimierungsziel und keine harte Sperre. Unterbrechungen werden nicht als
                  normale Abfertigungsdauer eingelernt.
                </p>
              </div>
              <label>
                <FieldLabel
                  label="Referenzgewicht Kind (kg)"
                  help="Anonymer Rechenwert für Tickets der Gewichtsklasse Kind; keine flugbetriebliche Freigabe."
                />
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={childReferenceWeightKg}
                  onChange={(event) => setChildReferenceWeightKg(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Referenzgewicht Normal (kg)"
                  help="Anonymer Rechenwert für Tickets der Gewichtsklasse Normal; keine flugbetriebliche Freigabe."
                />
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={normalReferenceWeightKg}
                  onChange={(event) => setNormalReferenceWeightKg(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Referenzgewicht Schwer (kg)"
                  help="Anonymer Rechenwert für Tickets der Gewichtsklasse Schwer; keine flugbetriebliche Freigabe."
                />
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={heavyReferenceWeightKg}
                  onChange={(event) => setHeavyReferenceWeightKg(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Plan Boarding (Min.)"
                  help="Planwert für das Einsteigen zur initialen Prognose; tatsächliche Ereignisse ersetzen ihn im Betrieb."
                />
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={plannedBoardingMinutes}
                  onChange={(event) => setPlannedBoardingMinutes(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Plan Ausstieg (Min.)"
                  help="Planwert für Ausstieg und Bodenprozess nach der Landung."
                />
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={plannedDeboardingMinutes}
                  onChange={(event) => setPlannedDeboardingMinutes(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Plan Puffer (Min.)"
                  help="Zusätzlicher organisatorischer Zeitpuffer zwischen Umläufen."
                />
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={plannedBufferMinutes}
                  onChange={(event) => setPlannedBufferMinutes(Number(event.target.value))}
                />
              </label>
              <label>
                <FieldLabel
                  label="Abgeflogene Zeilen sichtbar (Sek.)"
                  help="FIDS blendet abgeflogene Gruppen nach dieser Frist aus. Zulässig sind 5 bis 900 Sekunden."
                />
                <input
                  type="number"
                  min="5"
                  max="900"
                  value={departedVisibilitySeconds}
                  onChange={(event) => setDepartedVisibilitySeconds(Number(event.target.value))}
                />
              </label>
            </div>
            {!operationsEndAt ? (
              <ValidationHint tone="error">Ein Betriebsende muss festgelegt werden.</ValidationHint>
            ) : null}
          </section>
          <section className="admin-section setup-release" hidden={adminArea !== "setup"}>
            <div className="section-heading">
              <div>
                <h2>Betriebsfreigabe</h2>
                <p>Der Verkauf kann erst nach vollständiger Einrichtung gestartet werden.</p>
              </div>
              <strong>
                {setupSteps.filter((step) => step.complete).length}/{setupSteps.length} Schritte
              </strong>
            </div>
            <ul className="setup-checklist">
              {setupSteps.slice(0, -1).map((step) => (
                <li className={step.complete ? "complete" : "missing"} key={step.id}>
                  <span aria-hidden="true">{step.complete ? "✓" : "–"}</span>
                  <button onClick={() => openSetupStep(step)} type="button">
                    {step.label}
                  </button>
                  <strong>{step.complete ? "Erledigt" : "Fehlt"}</strong>
                </li>
              ))}
            </ul>
            {setupSteps.slice(0, -1).some((step) => !step.complete) ? (
              <ValidationHint tone="error">
                Vor der Betriebsfreigabe müssen alle fehlenden Einrichtungsschritte abgeschlossen
                werden.
              </ValidationHint>
            ) : (
              <ValidationHint>
                Alle Stammdaten sind vollständig. Der Betrieb kann freigegeben werden.
              </ValidationHint>
            )}
            {!board ? (
              <p className="help-text">Der bestätigte Betriebsstand wird geladen.</p>
            ) : board.event.status === "PREPARATION" ? (
              <button
                className="primary-action release-action"
                disabled={
                  !isAdministrator || setupSteps.slice(0, -1).some((step) => !step.complete)
                }
                onClick={() => requestAdminAction(() => setEventLifecycle("ACTIVE"))}
                type="button"
              >
                Veranstaltung aktivieren
              </button>
            ) : (
              <p className="success-message">
                Der Veranstaltungsbetrieb wurde bereits freigegeben.
              </p>
            )}
          </section>
          <MasterDataNavigation
            activeCategory={masterDataCategory}
            counts={masterDataCounts}
            onChange={(category) => {
              setMasterDataCategory(category);
              setMasterSearch("");
              setMasterSubmitAttempted(false);
              setMasterEditorOpen(false);
            }}
          />
          <section className="master-data-workspace" hidden={adminArea !== "master-data"}>
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
                      <th>Bezeichnung</th>
                      <th>Status</th>
                      <th>Aktionen</th>
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
                        <td>
                          <span className={`status-text ${gate.active ? "active" : "inactive"}`}>
                            {gate.active ? "Aktiv" : "Inaktiv"}
                          </span>
                        </td>
                        <td>
                          <button
                            aria-label={`${gate.label} öffnen`}
                            className="table-overflow-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectGateForEditing(gate.id);
                            }}
                            type="button"
                          >
                            ⋯
                          </button>
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
                      <th>Ressourcengruppe</th>
                      <th>Status</th>
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
                          <small>
                            {group.activeAircraftIds.length} Flugzeug
                            {group.activeAircraftIds.length === 1 ? "" : "e"} · Kapazität{" "}
                            {group.referenceCapacity}{" "}
                            {group.referenceCapacity === 1 ? "Platz" : "Plätze"} · {group.gateLabel}
                          </small>
                        </td>
                        <td>
                          <span
                            className={`status-text ${group.status === "ACTIVE" ? "active" : "inactive"}`}
                          >
                            {group.status === "ACTIVE" ? "Aktiv" : group.status}
                          </span>
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
                      <th>Kennung</th>
                      <th>Flugzeugtyp</th>
                      <th>Sitzplätze</th>
                      <th>Ressourcengruppe</th>
                      <th>Status</th>
                      <th>Aktionen</th>
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
                        <td>{aircraft.resourceGroupName || "Nicht zugeordnet"}</td>
                        <td>
                          <span
                            className={`status-text ${aircraft.operationalState === "INACTIVE" ? "inactive" : "active"}`}
                          >
                            {aircraftStateLabel[aircraft.operationalState]}
                          </span>
                        </td>
                        <td>
                          <button
                            aria-label={`${aircraft.registration} öffnen`}
                            className="table-overflow-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectAircraftForEditing(aircraft.id);
                            }}
                            type="button"
                          >
                            ⋯
                          </button>
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
                      <th>Aktionen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedAircraft.map((aircraft) => (
                      <tr
                        className={
                          masterEditorOpen && assignmentAircraftId === aircraft.id ? "selected" : ""
                        }
                        key={aircraft.id}
                        onClick={() => {
                          setAssignmentAircraftId(aircraft.id);
                          setAssignmentResourceGroupId(aircraft.resourceGroupId);
                          setMasterSubmitAttempted(false);
                          setMasterEditorOpen(true);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            setAssignmentAircraftId(aircraft.id);
                            setAssignmentResourceGroupId(aircraft.resourceGroupId);
                            setMasterSubmitAttempted(false);
                            setMasterEditorOpen(true);
                          }
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <strong>{aircraft.registration}</strong>
                        </td>
                        <td>{aircraft.aircraftType}</td>
                        <td>{aircraft.resourceGroupName || "Nicht zugeordnet"}</td>
                        <td>
                          <button
                            aria-label={`Zuordnung von ${aircraft.registration} öffnen`}
                            className="table-overflow-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              setAssignmentAircraftId(aircraft.id);
                              setAssignmentResourceGroupId(aircraft.resourceGroupId);
                              setMasterSubmitAttempted(false);
                              setMasterEditorOpen(true);
                            }}
                            type="button"
                          >
                            ⋯
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {masterDataCategory === "pilots" ? (
                <table className="master-data-table">
                  <thead>
                    <tr>
                      <th>Operativer Code</th>
                      <th>Organisatorische Bemerkung</th>
                      <th>Status</th>
                      <th>Aktueller Umlauf</th>
                      <th>Aktionen</th>
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
                            {pilot.active ? "Aktiv" : "Inaktiv"}
                          </span>
                        </td>
                        <td>
                          {pilot.currentCommunicationNumber
                            ? `Fluggruppe ${pilot.currentCommunicationNumber}`
                            : "Nicht zugeordnet"}
                        </td>
                        <td>
                          <button
                            aria-label={`${pilot.operationalCode} öffnen`}
                            className="table-overflow-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectPilotForEditing(pilot.id);
                            }}
                            type="button"
                          >
                            ⋯
                          </button>
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
                      <th>Kürzel</th>
                      <th>Bezeichnung</th>
                      <th>Ressourcengruppe</th>
                      <th>Gate</th>
                      <th>Status</th>
                      <th>Aktionen</th>
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
                          <span
                            className={`status-text ${product.saleEnabled ? "active" : "inactive"}`}
                          >
                            {product.saleEnabled ? "Verkauf aktiv" : "Verkauf gesperrt"}
                          </span>
                        </td>
                        <td>
                          <button
                            aria-label={`${product.name} öffnen`}
                            className="table-overflow-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectProductForEditing(product.id);
                            }}
                            type="button"
                          >
                            ⋯
                          </button>
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
          <section
            className="admin-section master-data-editor master-data-drawer"
            hidden={
              adminArea !== "master-data" ||
              !masterEditorOpen ||
              !["gates", "products"].includes(masterDataCategory)
            }
          >
            <div className="drawer-heading">
              <h2>
                {masterDataCategory === "gates"
                  ? gateEditorId === "new"
                    ? "Gate anlegen"
                    : "Gate bearbeiten"
                  : productEditorId === "new"
                    ? "Produkt anlegen"
                    : "Produkt bearbeiten"}
              </h2>
              <button
                aria-label="Editor schließen"
                onClick={() => setMasterEditorOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="master-data-columns">
              <fieldset hidden={masterDataCategory !== "gates"}>
                <legend>Gate</legend>
                <p className="form-introduction">
                  Ein Gate ist der sichtbare Treff- oder Ausgabepunkt einer Ressourcengruppe. Für
                  den normalen Betrieb genügt eine Bezeichnung; technische Gate-Arten sind nicht
                  erforderlich.
                </p>
                <label>
                  <FieldLabel
                    label="Bezeichnung"
                    help="Kurzer, vor Ort eindeutig sichtbarer Name, zum Beispiel Eingang Halle oder Flight Line Nord."
                  />
                  <input value={gateLabel} onChange={(event) => setGateLabel(event.target.value)} />
                </label>
                <div className="gate-active-field">
                  <FieldLabel
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
                      <FieldLabel
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
                      <FieldLabel
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
                <button
                  className="primary-action"
                  disabled={!isAdministrator}
                  onClick={() => requestMasterSave("gate", gateLabel.trim().length >= 2)}
                  type="button"
                >
                  Gate speichern
                </button>
                {gateEditorId !== "new" ? (
                  <div className="master-delete-zone">
                    <div>
                      <strong>Gate löschen</strong>
                      <span>Nur in der Vorbereitung und ohne operative Verwendung möglich.</span>
                    </div>
                    <button
                      className="danger-link-action"
                      onClick={() => requestMasterDelete("GATE", gateEditorId, gateLabel)}
                      type="button"
                    >
                      Löschen
                    </button>
                  </div>
                ) : null}
              </fieldset>
              <fieldset hidden={masterDataCategory !== "products"}>
                <legend>Produkt</legend>
                <section className="product-editor-section">
                  <h3>Allgemein</h3>
                  <div className="parameter-grid">
                    <label>
                      <FieldLabel
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
                    </label>
                    <label>
                      <FieldLabel
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
                    </label>
                    <label>
                      <FieldLabel
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
                    </label>
                    <label className="product-description-field">
                      <FieldLabel
                        label="Öffentliche Beschreibung"
                        help="Kurzer Text für Kasse und öffentliche Anzeigen."
                      />
                      <input
                        value={productDescription}
                        maxLength={240}
                        onChange={(event) => setProductDescription(event.target.value)}
                      />
                    </label>
                  </div>
                </section>
                <section className="product-editor-section">
                  <h3>Planung</h3>
                  <div className="parameter-grid">
                    <label>
                      <FieldLabel
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
                    </label>
                    <label>
                      <FieldLabel
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
                    </label>
                    <label>
                      <FieldLabel
                        label="Referenzdauer"
                        help="Planwert für den Kaltstart der Prognose, keine zugesagte Flugzeit."
                      />
                      <input
                        type="number"
                        min="1"
                        max="600"
                        value={productReferenceDuration}
                        onChange={(event) =>
                          setProductReferenceDuration(Number(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      <FieldLabel
                        label="Zugesagte Flugzeit (Min.)"
                        help="Öffentlich kommunizierte reine Flugzeit des Produkts. Sie ändert die operative Prognose nicht."
                      />
                      <input
                        type="number"
                        min="1"
                        max="600"
                        value={productPromisedFlightMinutes}
                        onChange={(event) =>
                          setProductPromisedFlightMinutes(Number(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      <FieldLabel
                        label="Position in Anzeigen"
                        help="Legt nur die Reihenfolge in Kasse und Anzeigen fest. Queue und Priorität ändern sich dadurch nicht."
                      />
                      <select
                        value={productSortOrder}
                        onChange={(event) => setProductSortOrder(Number(event.target.value))}
                      >
                        {productPositionChoices.map((option) => (
                          <option key={`${option.value}-${option.label}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>
                <section className="product-editor-section product-weight-section">
                  <h3>Angaben beim Verkauf</h3>
                  <FieldLabel
                    label="Gewichtserfassung"
                    help="Aktivierte Klassen werden an der Kasse je anonymem Ticket abgefragt. Es werden keine Namen erfasst."
                  />
                  <div className="weight-capture-mode" id="product-weight-capture">
                    <label>
                      <input
                        checked={!weightCaptureEnabled(productWeightClasses)}
                        name="product-weight-mode"
                        onChange={() => {
                          setProductWeightClasses(setWeightCaptureMode(false));
                          setProductChildCompanion(false);
                        }}
                        type="radio"
                      />
                      <span>Keine Gewichtserfassung</span>
                    </label>
                    <label>
                      <input
                        checked={weightCaptureEnabled(productWeightClasses)}
                        name="product-weight-mode"
                        onChange={() => setProductWeightClasses(setWeightCaptureMode(true))}
                        type="radio"
                      />
                      <span>Gewichtsklassen erfassen</span>
                    </label>
                  </div>
                  {weightCaptureEnabled(productWeightClasses) ? (
                    <div className="weight-class-options">
                      {(
                        [
                          ["CHILD", "Kind"],
                          ["NORMAL", "Standard"],
                          ["HEAVY", "Schwer"],
                          ["INDIVIDUAL", "Individuelles Gewicht"],
                        ] as const
                      ).map(([weightClass, label]) => (
                        <label key={weightClass}>
                          <input
                            type="checkbox"
                            checked={productWeightClasses.includes(weightClass)}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setProductWeightClasses((current) =>
                                toggleWeightClass(current, weightClass, checked),
                              );
                              if (weightClass === "CHILD" && !checked)
                                setProductChildCompanion(false);
                            }}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {masterSubmitAttempted && productWeightClasses.length === 0 ? (
                    <span className="field-error">Mindestens eine Gewichtsklasse auswählen.</span>
                  ) : null}
                  <div className="checkbox-field">
                    <div className="checkbox-field-heading">
                      <label className="checkbox-label">
                        <input
                          id="product-child-companion"
                          type="checkbox"
                          checked={productChildCompanion}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setProductChildCompanion(checked);
                            if (checked) {
                              setProductWeightClasses((current) =>
                                weightClassesForChildCompanion(current, true),
                              );
                            }
                          }}
                        />
                        <span>Bei Kinderbuchungen auf Begleitung hinweisen</span>
                      </label>
                      <FieldHelp help="Aktiviert bei Bedarf automatisch die Gewichtsklasse „Kind“ und zeigt an der Kasse einen organisatorischen Hinweis, wenn keine passende Begleitung erfasst ist. Dies ist keine flugbetriebliche Freigabe." />
                    </div>
                    <span className="field-help">
                      Die Auswahl „Kind“ wird beim Aktivieren automatisch eingeschaltet.
                    </span>
                  </div>
                </section>
                <div className="editor-actions product-editor-actions">
                  <button onClick={() => setMasterEditorOpen(false)} type="button">
                    Abbrechen
                  </button>
                  <button
                    className="primary-action"
                    disabled={!isAdministrator}
                    onClick={requestProductSave}
                    type="button"
                  >
                    <span>Produkt speichern</span>
                  </button>
                </div>
                {productEditorId !== "new" ? (
                  <div className="master-delete-zone">
                    <div>
                      <strong>Produkt löschen</strong>
                      <span>Nur ohne Tickets oder Umläufe möglich.</span>
                    </div>
                    <button
                      className="danger-link-action"
                      onClick={() => requestMasterDelete("PRODUCT", productEditorId, productName)}
                      type="button"
                    >
                      Löschen
                    </button>
                  </div>
                ) : null}
              </fieldset>
            </div>
          </section>
          <section
            className="admin-section master-data-editor master-data-drawer"
            hidden={
              adminArea !== "master-data" ||
              !masterEditorOpen ||
              !["resource-groups", "aircraft", "assignments"].includes(masterDataCategory)
            }
          >
            <div className="drawer-heading">
              <h2>
                {masterDataCategory === "resource-groups"
                  ? resourceEditorId === "new"
                    ? "Ressourcengruppe anlegen"
                    : "Ressourcengruppe bearbeiten"
                  : masterDataCategory === "assignments"
                    ? "Zuordnung ändern"
                    : aircraftEditorId === "new"
                      ? "Flugzeug anlegen"
                      : "Flugzeug bearbeiten"}
              </h2>
              <button
                aria-label="Editor schließen"
                onClick={() => setMasterEditorOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="resource-master-grid">
              <fieldset hidden={masterDataCategory !== "resource-groups"}>
                <legend>Ressourcengruppe</legend>
                <label>
                  <FieldLabel
                    label="Bezeichnung"
                    help="Lesbarer Name der gemeinsamen operativen Warteschlange."
                  />
                  <input
                    value={resourceName}
                    onChange={(event) => setResourceName(event.target.value)}
                  />
                </label>
                <label>
                  <FieldLabel
                    label="Gate"
                    help="Standardmäßiger Treffpunkt für Produkte und Umläufe dieser Ressourcengruppe."
                  />
                  <select
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
                </label>
                <label>
                  <FieldLabel
                    label="Plan-Umlaufzeit (Min.)"
                    help="Initialer Zeitwert eines vollständigen Umlaufs für die Prognose."
                  />
                  <input
                    type="number"
                    min="1"
                    max="600"
                    value={resourcePlannedMinutes}
                    onChange={(event) => setResourcePlannedMinutes(Number(event.target.value))}
                  />
                </label>
                <label className="admin-check-row">
                  <input
                    checked={resourceAutomaticPrecall}
                    onChange={(event) => setResourceAutomaticPrecall(event.target.checked)}
                    type="checkbox"
                  />
                  <FieldLabel
                    label="Automatischer Voraufruf für diese Gruppe"
                    help="Kann für einzelne Ressourcengruppen abgeschaltet werden. Belegung, Pilot und Boarding bleiben immer manuell bestätigt."
                  />
                </label>
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
                {masterSubmitAttempted && (resourceName.trim().length < 2 || !resourceGateId) ? (
                  <ValidationHint tone="error">
                    Bezeichnung und Gate müssen für die Ressourcengruppe angegeben werden.
                  </ValidationHint>
                ) : null}
                <button
                  className="primary-action"
                  disabled={!isAdministrator}
                  onClick={() =>
                    requestMasterSave(
                      "resource-group",
                      resourceName.trim().length >= 2 && Boolean(resourceGateId),
                    )
                  }
                  type="button"
                >
                  Ressourcengruppe speichern
                </button>
                {resourceEditorId !== "new" ? (
                  <div className="master-delete-zone">
                    <div>
                      <strong>Ressourcengruppe löschen</strong>
                      <span>Produkte und Flugzeugzuordnungen müssen vorher entfernt sein.</span>
                    </div>
                    <button
                      className="danger-link-action"
                      onClick={() =>
                        requestMasterDelete("RESOURCE_GROUP", resourceEditorId, resourceName)
                      }
                      type="button"
                    >
                      Löschen
                    </button>
                  </div>
                ) : null}
              </fieldset>
              <fieldset hidden={masterDataCategory !== "aircraft"}>
                <legend>Flugzeug</legend>
                <label>
                  <FieldLabel
                    label="Kennzeichen"
                    help="Eindeutiges operatives Luftfahrzeugkennzeichen, beispielsweise D-EXYZ."
                  />
                  <input
                    value={aircraftRegistration}
                    maxLength={16}
                    onChange={(event) => setAircraftRegistration(event.target.value.toUpperCase())}
                  />
                </label>
                <label>
                  <FieldLabel
                    label="Flugzeugtyp"
                    help="Typbezeichnung zur Prüfung gegen kompatible Ressourcengruppen."
                  />
                  <input
                    value={aircraftType}
                    onChange={(event) => setAircraftType(event.target.value)}
                  />
                </label>
                <label>
                  <FieldLabel
                    label="Passagierplätze"
                    help="Maximale Ticketanzahl je Umlauf; Besatzungsplätze werden hier nicht eingetragen."
                  />
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={aircraftSeats}
                    onChange={(event) => setAircraftSeats(Number(event.target.value))}
                  />
                </label>
                <label>
                  <FieldLabel
                    label="Max. Passagierzuladung (kg)"
                    help="Optionaler organisatorischer Hinweiswert. Er besitzt keine Freigabe- oder Sicherheitssemantik."
                  />
                  <input
                    type="number"
                    min="1"
                    value={aircraftMaximumPayload}
                    onChange={(event) => setAircraftMaximumPayload(event.target.value)}
                  />
                </label>
                {masterSubmitAttempted &&
                (aircraftRegistration.trim().length < 3 || aircraftType.trim().length < 2) ? (
                  <ValidationHint tone="error">
                    Kennzeichen und Flugzeugtyp müssen mindestens 2 Zeichen lang sein.
                  </ValidationHint>
                ) : null}
                <button
                  className="primary-action"
                  disabled={!isAdministrator}
                  onClick={() =>
                    requestMasterSave(
                      "aircraft",
                      aircraftRegistration.trim().length >= 3 && aircraftType.trim().length >= 2,
                    )
                  }
                  type="button"
                >
                  Flugzeug speichern
                </button>
                {aircraftEditorId !== "new" ? (
                  <div className="master-delete-zone">
                    <div>
                      <strong>Flugzeug löschen</strong>
                      <span>Eine bestehende Zuordnung muss zuerst entfernt werden.</span>
                    </div>
                    <button
                      className="danger-link-action"
                      onClick={() =>
                        requestMasterDelete("AIRCRAFT", aircraftEditorId, aircraftRegistration)
                      }
                      type="button"
                    >
                      Löschen
                    </button>
                  </div>
                ) : null}
              </fieldset>
              <fieldset hidden={masterDataCategory !== "assignments"}>
                <legend>Historisierte Zuordnung</legend>
                <label>
                  <FieldLabel
                    label="Flugzeug"
                    help="Flugzeug, dessen aktive Ressourcengruppenzuordnung geändert werden soll."
                  />
                  <select
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
                </label>
                <label>
                  <FieldLabel
                    label="Neue Ressourcengruppe"
                    help="Zielgruppe der neuen historisierten Zuordnung. Ein Flugzeug kann gleichzeitig nur einer aktiven Gruppe angehören."
                  />
                  <select
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
                </label>
                <p>
                  Wirksam ab Bestätigung. Aktive Umläufe und inkompatible Flugzeugtypen werden
                  serverseitig abgewiesen.
                </p>
                {masterSubmitAttempted && (!assignmentAircraftId || !assignmentResourceGroupId) ? (
                  <ValidationHint tone="error">
                    Flugzeug und neue Ressourcengruppe müssen ausgewählt werden.
                  </ValidationHint>
                ) : null}
                <button
                  className="primary-action"
                  disabled={!isAdministrator}
                  onClick={() =>
                    requestMasterSave(
                      "assignment",
                      Boolean(assignmentAircraftId && assignmentResourceGroupId),
                    )
                  }
                  type="button"
                >
                  Zuordnung ändern
                </button>
                {assignmentAircraftId &&
                board?.aircraft.find((entry) => entry.id === assignmentAircraftId)
                  ?.resourceGroupId ? (
                  <div className="master-delete-zone">
                    <div>
                      <strong>Zuordnung entfernen</strong>
                      <span>Das Flugzeug und die Ressourcengruppe bleiben erhalten.</span>
                    </div>
                    <button
                      className="danger-link-action"
                      onClick={() =>
                        requestMasterDelete(
                          "ASSIGNMENT",
                          assignmentAircraftId,
                          `Zuordnung ${board?.aircraft.find((entry) => entry.id === assignmentAircraftId)?.registration ?? ""}`,
                        )
                      }
                      type="button"
                    >
                      Entfernen
                    </button>
                  </div>
                ) : null}
              </fieldset>
            </div>
          </section>
          <section
            className="admin-section master-data-editor master-data-drawer"
            hidden={
              adminArea !== "master-data" || !masterEditorOpen || masterDataCategory !== "pilots"
            }
          >
            <div className="drawer-heading">
              <h2>{pilotEditorId === "new" ? "Pilotencode anlegen" : "Pilotencode bearbeiten"}</h2>
              <button
                aria-label="Editor schließen"
                onClick={() => setMasterEditorOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="parameter-grid compact-editor-grid">
              <label>
                <FieldLabel
                  label="Operativer Pilotencode"
                  help="Anonymer technischer Code für die operative Zuordnung; keine Namen oder Lizenzdaten erfassen."
                />
                <input
                  aria-label="Operativer Pilotencode"
                  value={pilotCode}
                  onChange={(event) => setPilotCode(event.target.value.toUpperCase())}
                />
                <span className="field-help">
                  Nur technische Codes, keine Namen oder Lizenzdaten.
                </span>
              </label>
              <label>
                <FieldLabel
                  label="Organisatorische Bemerkung"
                  help="Optionaler nicht personenbezogener Hinweis, zum Beispiel Einsatzbereich oder Schicht."
                />
                <input
                  value={pilotNote}
                  onChange={(event) => setPilotNote(event.target.value)}
                  placeholder="Optional · keine personenbezogenen Daten"
                />
              </label>
            </div>
            {masterSubmitAttempted && !/^[A-Z0-9-]{2,12}$/.test(pilotCode) ? (
              <ValidationHint tone="error">
                Der Pilotencode muss aus 2 bis 12 Großbuchstaben, Ziffern oder Bindestrichen
                bestehen.
              </ValidationHint>
            ) : null}
            <div className="editor-actions">
              <button
                className="primary-action"
                disabled={!isAdministrator}
                onClick={() => requestMasterSave("pilot", /^[A-Z0-9-]{2,12}$/.test(pilotCode))}
                type="button"
              >
                {pilotEditorId === "new" ? "Pilotencode anlegen" : "Änderungen speichern"}
              </button>
              <button onClick={() => setMasterEditorOpen(false)} type="button">
                Abbrechen
              </button>
              {pilotEditorId !== "new" ? (
                <button
                  disabled={!isAdministrator}
                  onClick={() => requestMasterSave("pilot-toggle", true)}
                  type="button"
                >
                  {board?.pilots.find((pilot) => pilot.id === pilotEditorId)?.active
                    ? "Deaktivieren"
                    : "Aktivieren"}
                </button>
              ) : null}
            </div>
            {pilotEditorId !== "new" ? (
              <div className="master-delete-zone">
                <div>
                  <strong>Pilotencode löschen</strong>
                  <span>Nur ohne Umlauf oder Flugzeugbindung möglich.</span>
                </div>
                <button
                  className="danger-link-action"
                  onClick={() => requestMasterDelete("PILOT", pilotEditorId, pilotCode)}
                  type="button"
                >
                  Löschen
                </button>
              </div>
            ) : null}
          </section>
          <section
            className="admin-section"
            hidden={!(["evaluation", "audit"] as AdminArea[]).includes(adminArea)}
          >
            <h2>Notfallmodus</h2>
            <label>
              <FieldLabel
                label="Begründung für den Notfallmodus"
                help="Nur außergewöhnliche Eingriffe benötigen einen frei eingegebenen Grund. Normale Betriebsänderungen werden automatisch protokolliert."
              />
              <input
                onChange={(event) => setReason(event.target.value)}
                placeholder="Mindestens 3 Zeichen"
                value={reason}
              />
            </label>
            {!board?.event.emergencyMode ? (
              <button
                className="danger-action"
                disabled={reason.trim().length < 3}
                onClick={() => emergency("TRIGGER_EMERGENCY")}
                type="button"
              >
                Not-Halt auslösen
              </button>
            ) : (
              <button
                className="danger-action"
                disabled={!isAdministrator || reason.trim().length < 3}
                onClick={() => requestAdminAction(() => emergency("CLEAR_EMERGENCY"))}
                type="button"
              >
                Notfallmodus aufheben
              </button>
            )}
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
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
            hidden={adminArea !== "evaluation"}
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
              <label>
                <FieldLabel
                  label="Zu korrigierende Buchungsgruppe"
                  help="Es werden nur anonyme Gruppen angeboten, deren dokumentierter Umlauf bereits im Flug, gelandet oder abgeschlossen ist."
                />
                <select
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
              </label>
              <label>
                <FieldLabel
                  label="Tatsächlicher Zielumlauf"
                  help="Der Zielumlauf muss mindestens den Status Im Flug erreicht haben. Bisherige Umläufe der Gruppe sind ausgeschlossen."
                />
                <select
                  disabled={!selectedManifestCandidate}
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
              </label>
              <label className="manifest-reason-field">
                <FieldLabel
                  label="Dokumentationsgrund"
                  help="Mindestens 10 Zeichen. Der Grund wird zusammen mit Quelle, Ziel, Gerät und Version dauerhaft auditiert."
                />
                <textarea
                  maxLength={500}
                  placeholder="Zum Beispiel: Tatsächliche Besetzung nach Rückmeldung der Flight Line berichtigen"
                  value={manifestCorrectionReason}
                  onChange={(event) => setManifestCorrectionReason(event.target.value)}
                />
                <small>{manifestCorrectionReason.trim().length}/10 Mindestzeichen</small>
              </label>
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
            <button
              className="primary-action manifest-correction-action"
              disabled={
                !isAdministrator ||
                !manifestTicketGroupId ||
                !manifestTargetRotationId ||
                manifestCorrectionReason.trim().length < 10
              }
              onClick={() => requestAdminAction(correctRotationManifest)}
              type="button"
            >
              Besetzung protokolliert korrigieren
            </button>
            {manifestCandidates.length === 0 ? (
              <p className="help-text">Aktuell ist keine Korrektur nach Flugstart erforderlich.</p>
            ) : null}
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
            <h2>Betriebs- und Wetterhinweise</h2>
            <label>
              <FieldLabel
                label="Organisatorischer Hinweis"
                help="Öffentlich sichtbare Information ohne automatische Auswirkung auf Verkauf oder Flugbetrieb."
              />
              <input
                value={operationalNotice}
                maxLength={240}
                onChange={(event) => setOperationalNotice(event.target.value)}
                placeholder="Hinweis setzen oder leer speichern zum Entfernen"
              />
            </label>
            <div className="secondary-actions notice-actions">
              <button onClick={() => setNotice()} type="button">
                Für gesamte Veranstaltung veröffentlichen
              </button>
              {resourceGroups.map((group) => (
                <button key={group.id} onClick={() => setNotice(group.id)} type="button">
                  Für {group.name} veröffentlichen
                </button>
              ))}
            </div>
            <button
              className="interrupt-action"
              onClick={() => setEventInterruption(!(board?.event.operationalInterrupted ?? false))}
              type="button"
            >
              {board?.event.operationalInterrupted
                ? "Veranstaltungsbetrieb fortsetzen"
                : "Veranstaltungsbetrieb unterbrechen"}
            </button>
            <p>Hinweise stoppen keinen Flugbetrieb. Unterbrechungen werden separat gesetzt.</p>
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
            <h2>Kapazität und Verkaufsempfehlung</h2>
            <LocalizedDateTimeInput
              label="Neuer harter Verkaufsschluss"
              labelContent={
                <FieldLabel
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
                    <button
                      disabled={!isAdministrator}
                      onClick={() =>
                        requestAdminAction(() =>
                          configureProductSales(product, !product.saleEnabled),
                        )
                      }
                      type="button"
                    >
                      {product.saleEnabled ? "Verkauf sperren" : "Verkauf freigeben"}
                    </button>
                    <button
                      disabled={!isAdministrator || !saleClosesAt}
                      onClick={() =>
                        requestAdminAction(() =>
                          configureProductSales(product, product.saleEnabled, true),
                        )
                      }
                      type="button"
                    >
                      Verkaufsschluss setzen
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
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
                    <button
                      disabled={
                        !["REFUELING", "PAUSED", "INACTIVE", "INTERRUPTED"].includes(
                          aircraft.operationalState,
                        )
                      }
                      onClick={() => setAircraftState(aircraft.id, "AVAILABLE")}
                      type="button"
                    >
                      Verfügbar
                    </button>
                    <button
                      disabled={aircraft.operationalState !== "AVAILABLE"}
                      onClick={() => setAircraftState(aircraft.id, "PAUSED")}
                      type="button"
                    >
                      Pause
                    </button>
                    <button
                      disabled={aircraft.operationalState !== "AVAILABLE"}
                      onClick={() => setAircraftState(aircraft.id, "REFUELING")}
                      type="button"
                    >
                      Tanken aktuell
                    </button>
                    <button
                      disabled={aircraft.operationalState !== "AVAILABLE"}
                      onClick={() => setAircraftState(aircraft.id, "INACTIVE")}
                      type="button"
                    >
                      Inaktiv
                    </button>
                    <button
                      disabled={aircraft.operationalState !== "AVAILABLE"}
                      onClick={() => setAircraftState(aircraft.id, "INTERRUPTED")}
                      type="button"
                    >
                      Unterbrechen
                    </button>
                    <button
                      onClick={() => scheduleRefuel(aircraft.id, !aircraft.refuelPlanned)}
                      type="button"
                    >
                      {aircraft.refuelPlanned ? "Vormerkung aufheben" : "Tanken vormerken"}
                    </button>
                    <button
                      disabled={!isAdministrator}
                      onClick={() =>
                        requestAdminAction(() => configureRefuelThreshold(aircraft.id))
                      }
                      type="button"
                    >
                      Schwelle {refuelThreshold} setzen
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <label className="threshold-input">
              <FieldLabel
                label="Umläufe bis Tank-Erinnerung"
                help="Rein organisatorischer Erinnerungswert je Flugzeug; keine Kraftstoff- oder Freigabeentscheidung."
              />
              <input
                type="number"
                min={1}
                max={100}
                value={refuelThreshold}
                onChange={(event) => setRefuelThreshold(Number(event.target.value))}
              />
            </label>
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
                  <button
                    disabled={!pilot.active}
                    onClick={() => setPilotPause(pilot.id, !pilot.paused)}
                    type="button"
                  >
                    {pilot.paused ? "Pause beenden" : "Pause starten"}
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
            <h2>Ressourcengruppen</h2>
            {resourceGroups.map((group) => (
              <div className="resource-control" key={group.id}>
                <div>
                  <strong>{group.name}</strong>
                  <span>{group.status}</span>
                </div>
                <div className="secondary-actions">
                  <button onClick={() => setResourceStatus(group.id, "PAUSED")} type="button">
                    Pausieren
                  </button>
                  <button onClick={() => setResourceStatus(group.id, "INTERRUPTED")} type="button">
                    Unterbrechen
                  </button>
                  <button onClick={() => setResourceStatus(group.id, "ACTIVE")} type="button">
                    Aktivieren
                  </button>
                  <button
                    disabled={group.status === "ENDED"}
                    onClick={() => setResourceStatus(group.id, "ENDED")}
                    type="button"
                  >
                    Beenden
                  </button>
                </div>
              </div>
            ))}
          </section>
          <section className="admin-section" hidden={adminArea !== "backup"}>
            <h2>Technische Geräte</h2>
            <div className="device-admin-context">
              <div>
                <strong>Geräteänderung bestätigen</strong>
                <span>
                  Gerätebindungen werden durch das angemeldete Administrationskonto verwaltet.
                  Begründungen sind nur für Widerrufe erforderlich.
                </span>
              </div>
              <label>
                <FieldLabel
                  label="Begründung"
                  help="Wird nur beim Widerruf einer Gerätebindung verlangt und dauerhaft auditiert."
                />
                <input
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Für einen Widerruf"
                  value={reason}
                />
              </label>
            </div>
            <div className="device-pairing-form">
              <label>
                <FieldLabel
                  label="Technische Gerätebezeichnung"
                  help="Erkennbare, nicht personenbezogene Bezeichnung wie „Kasse Eingang“ oder „Flight Line 2“."
                />
                <input
                  value={deviceLabel}
                  onChange={(event) => setDeviceLabel(event.target.value)}
                />
              </label>
              <label>
                <FieldLabel
                  label="Feste Rolle"
                  help="Legt die Berechtigungen dieses Geräts dauerhaft fest. Eine spätere Änderung erfordert eine neue Kopplung."
                />
                <select
                  value={deviceRole}
                  onChange={(event) => setDeviceRole(event.target.value as typeof deviceRole)}
                >
                  <option value="CASHIER">Kasse</option>
                  <option value="FLIGHT_LINE">Flight Line</option>
                  <option value="FLIGHT_DIRECTOR">Flugleitung</option>
                  <option value="ADMIN">Administration</option>
                </select>
              </label>
              <button
                className="primary-action"
                disabled={!isAdministrator || deviceLabel.trim().length < 2}
                onClick={() => requestAdminAction(pairDevice)}
                type="button"
              >
                QR-Kopplung erzeugen
              </button>
            </div>
            {pairingQr && pairingUrl ? (
              <div className="pairing-qr">
                <img src={pairingQr} alt="QR-Code zur einmaligen Gerätekopplung" />
                <p>
                  Nur mit dem vorgesehenen Gerät scannen. Der QR-Code enthält dessen
                  Zugangsschlüssel.
                </p>
                <a href={pairingUrl}>Kopplung auf diesem Gerät öffnen</a>
              </div>
            ) : null}
            <div className="device-list">
              {devices.map((device) => (
                <div key={device.id}>
                  <span className={device.online ? "online-dot online" : "online-dot"} />
                  <strong>{device.label}</strong>
                  <span>{device.role}</span>
                  <span>
                    {device.active ? (device.online ? "online" : "offline") : "widerrufen"}
                  </span>
                  <time dateTime={device.lastSeenAt}>
                    zuletzt{" "}
                    {new Date(device.lastSeenAt).toLocaleString("de-DE", {
                      timeZone: board?.event.timeZone ?? "Europe/Berlin",
                    })}
                  </time>
                  {device.active ? (
                    <button
                      className="admin-revoke-action"
                      disabled={!isAdministrator || reason.trim().length < 3}
                      onClick={() => requestAdminAction(() => revokeDevice(device))}
                      type="button"
                    >
                      Widerrufen
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
          <section className="admin-section" hidden={adminArea !== "evaluation"}>
            <div className="section-heading">
              <h2>Audit und Tagesabschluss</h2>
              <div className="report-actions">
                <button onClick={exportDailyReport} type="button">
                  CSV-Tagesbericht
                </button>
                <button onClick={exportDailyPdf} type="button">
                  PDF-Tagesbericht
                </button>
                <button onClick={exportRawData} type="button">
                  Ticket-Rohdaten CSV
                </button>
                <button onClick={exportPerformanceProfile} type="button">
                  Leistungsprofil JSON
                </button>
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
                  <FieldLabel label="Von" help="Optionaler Beginn des ausgewerteten Zeitraums." />
                }
                value={historySince}
                onChange={setHistorySince}
              />
              <LocalizedDateTimeInput
                label="Bis"
                labelContent={
                  <FieldLabel label="Bis" help="Optionales Ende des ausgewerteten Zeitraums." />
                }
                value={historyUntil}
                onChange={setHistoryUntil}
              />
              {historyView === "AUDIT" ? (
                <>
                  <label>
                    <FieldLabel
                      label="Ereignistyp"
                      help="Technischer Audit-Ereignisname, beispielsweise TICKET_NO_SHOW. Leer zeigt alle Typen."
                    />
                    <input
                      value={historyEventType}
                      onChange={(event) => setHistoryEventType(event.target.value)}
                      placeholder="z. B. TICKET_NO_SHOW"
                    />
                  </label>
                  <label>
                    <FieldLabel
                      label="Bezugsart"
                      help="Art des betroffenen Objekts, beispielsweise ROTATION, TICKET oder PRODUCT."
                    />
                    <input
                      value={historyAggregateType}
                      onChange={(event) => setHistoryAggregateType(event.target.value)}
                      placeholder="z. B. ROTATION"
                    />
                  </label>
                  <label>
                    <FieldLabel
                      label="Bezugs-ID"
                      help="Interne anonyme Kennung eines bestimmten Objekts zur gezielten Nachverfolgung."
                    />
                    <input
                      value={historyAggregateId}
                      onChange={(event) => setHistoryAggregateId(event.target.value)}
                      placeholder="interne ID"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <FieldLabel
                      label="Flugzeug"
                      help="Begrenzt Betriebs- oder Prognoseeinträge auf ein Flugzeug."
                    />
                    <select
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
                  </label>
                  <label>
                    <FieldLabel
                      label="Pilotencode"
                      help="Begrenzt die Ansicht auf einen anonymen operativen Pilotencode."
                    />
                    <select
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
                  </label>
                  <label>
                    <FieldLabel
                      label="Umlauf-ID"
                      help="Interne Kennung eines konkreten Umlaufs; leer zeigt alle Umläufe."
                    />
                    <input
                      value={historyRotationId}
                      onChange={(event) => setHistoryRotationId(event.target.value)}
                      placeholder="interne ID"
                    />
                  </label>
                  {historyView === "OPERATIONS" ? (
                    <>
                      <label>
                        <FieldLabel
                          label="Ticketstatus"
                          help="Filtert nach dem aktuellen oder protokollierten anonymen Ticketzustand."
                        />
                        <select
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
                      </label>
                      <label>
                        <FieldLabel
                          label="Produkt"
                          help="Begrenzt die Betriebshistorie auf ein Produkt."
                        />
                        <select
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
                      </label>
                      <label>
                        <FieldLabel
                          label="Ressourcengruppe"
                          help="Begrenzt die Betriebshistorie auf die gemeinsame operative Queue."
                        />
                        <select
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
                      </label>
                      <label>
                        <FieldLabel
                          label="Fluggruppennummer"
                          help="Stabile öffentliche Kommunikationsnummer der Fluggruppe, keine garantierte Uhrzeit."
                        />
                        <input
                          min="1"
                          type="number"
                          value={historyCommunicationNumber}
                          onChange={(event) => setHistoryCommunicationNumber(event.target.value)}
                        />
                      </label>
                      <label>
                        <FieldLabel
                          label="Ticket-ID"
                          help="Interne anonyme Ticketkennung; nicht der öffentliche QR-Code."
                        />
                        <input
                          value={historyTicketId}
                          onChange={(event) => setHistoryTicketId(event.target.value)}
                          placeholder="interne ID"
                        />
                      </label>
                      <label>
                        <FieldLabel
                          label="Ticketgruppe"
                          help="Interne anonyme Kennung einer gemeinsam gebuchten und untrennbaren Gruppe."
                        />
                        <input
                          value={historyTicketGroupId}
                          onChange={(event) => setHistoryTicketGroupId(event.target.value)}
                          placeholder="interne ID"
                        />
                      </label>
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
                    <code>{entry.deviceId}</code>
                  </div>
                ))}
                {history.entries.length === 0 ? <p>Keine passenden Ereignisse.</p> : null}
              </div>
            )}
            {historyView !== "AUDIT" ? (
              <div className="history-pagination">
                <button
                  disabled={historyOffset === 0}
                  onClick={() => void refreshDetailedHistory(Math.max(0, historyOffset - 50))}
                  type="button"
                >
                  Zurück
                </button>
                <span>
                  {historyOffset + 1}–
                  {Math.min(
                    historyOffset + 50,
                    historyView === "OPERATIONS" ? operationalHistory.total : forecastHistory.total,
                  )}{" "}
                  von{" "}
                  {historyView === "OPERATIONS" ? operationalHistory.total : forecastHistory.total}
                </span>
                <button
                  disabled={
                    historyOffset + 50 >=
                    (historyView === "OPERATIONS"
                      ? operationalHistory.total
                      : forecastHistory.total)
                  }
                  onClick={() => void refreshDetailedHistory(historyOffset + 50)}
                  type="button"
                >
                  Weiter
                </button>
              </div>
            ) : null}
          </section>
          {adminPinDialog ? (
            <div className="modal-backdrop">
              <form
                aria-labelledby="admin-pin-dialog-title"
                aria-modal="true"
                className="confirmation-dialog"
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeAdminPinDialog();
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmAdminPinDialog();
                }}
                role="dialog"
              >
                <div className="drawer-heading">
                  <div>
                    <h2 id="admin-pin-dialog-title">
                      {adminPinDialog === "recover"
                        ? "Administrationszugang erneuern"
                        : adminPinDialog === "unlock"
                          ? "Bearbeitungsmodus entsperren"
                          : "Änderung bestätigen"}
                    </h2>
                    <p>
                      {adminPinDialog === "recover"
                        ? "Die Gerätebindung wird mit der Administrator-PIN neu ausgestellt. Vorhandene Betriebsdaten bleiben unverändert."
                        : adminPinDialog === "unlock"
                          ? "Die PIN gilt nur in diesem Browser-Tab und wird nach 15 Minuten Inaktivität verworfen."
                          : "Diese einzelne Änderung wird nach erfolgreicher PIN-Prüfung ausgeführt und protokolliert."}
                    </p>
                  </div>
                  <button
                    aria-label="Bestätigung schließen"
                    disabled={adminPinBusy}
                    onClick={closeAdminPinDialog}
                    type="button"
                  >
                    ×
                  </button>
                </div>
                <label>
                  Administrator-PIN
                  <input
                    autoComplete="current-password"
                    onChange={(event) => setAdminPin(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void confirmAdminPinDialog();
                      }
                    }}
                    ref={adminPinInputRef}
                    type="password"
                    value={adminPin}
                  />
                </label>
                {adminPinError ? (
                  <ValidationHint tone="error">{adminPinError}</ValidationHint>
                ) : null}
                <div className="dialog-actions">
                  <button disabled={adminPinBusy} onClick={closeAdminPinDialog} type="button">
                    Abbrechen
                  </button>
                  <button
                    className="primary-action"
                    disabled={adminPin.length < 4 || adminPinBusy}
                    type="submit"
                  >
                    {adminPinBusy
                      ? "PIN wird geprüft …"
                      : adminPinDialog === "recover"
                        ? "Zugang erneuern"
                        : adminPinDialog === "unlock"
                          ? "Entsperren"
                          : "Bestätigen"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}
          {pendingMasterDelete ? (
            <div className="modal-backdrop">
              <form
                aria-labelledby="master-delete-title"
                aria-modal="true"
                className="confirmation-dialog master-delete-dialog"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setPendingMasterDelete(null);
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmMasterDelete();
                }}
                role="dialog"
              >
                <div className="drawer-heading">
                  <div>
                    <span className="danger-eyebrow">Endgültig löschen</span>
                    <h2 id="master-delete-title">{pendingMasterDelete.label} löschen?</h2>
                    <p>Die Löschung wird mit Ihrer technischen Geräte-ID protokolliert.</p>
                  </div>
                  <button
                    aria-label="Löschen abbrechen"
                    onClick={() => setPendingMasterDelete(null)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
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
                  <p className="delete-ready-copy">
                    Der Datensatz hat keine erkennbaren Abhängigkeiten und kann in der Vorbereitung
                    entfernt werden. Der Server prüft dies vor der Löschung erneut.
                  </p>
                )}
                {!adminModeUnlocked ? (
                  <label>
                    Administrator-PIN
                    <input
                      autoComplete="current-password"
                      onChange={(event) => setAdminPin(event.target.value)}
                      ref={adminPinInputRef}
                      type="password"
                      value={adminPin}
                    />
                  </label>
                ) : (
                  <ValidationHint>
                    Bearbeitungsmodus aktiv. Die Löschung benötigt weiterhin diese ausdrückliche
                    Bestätigung.
                  </ValidationHint>
                )}
                <div className="dialog-actions">
                  <button onClick={() => setPendingMasterDelete(null)} type="button">
                    Abbrechen
                  </button>
                  <button
                    className="danger-action"
                    disabled={
                      board?.event.status !== "PREPARATION" ||
                      pendingMasterDelete.blockers.length > 0 ||
                      adminPin.length < 4
                    }
                    type="submit"
                  >
                    Endgültig löschen
                  </button>
                </div>
              </form>
            </div>
          ) : null}
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
                    <li>Alle Historien, Protokolle und Gerätebindungen</li>
                    <li>Die Ersteinrichtung und lokalen Zugangsdaten</li>
                  </ul>
                </div>
                <label>
                  <FieldLabel
                    label="Begründung"
                    help="Dokumentiert, warum der vollständige Werksreset ausgeführt wird."
                  />
                  <textarea
                    maxLength={240}
                    onChange={(event) => setFactoryResetReason(event.target.value)}
                    placeholder="Grund für den Werksreset"
                    value={factoryResetReason}
                  />
                </label>
                {session?.account.role !== "ADMIN" ? (
                  <label>
                    <FieldLabel
                      label="Administrator-PIN"
                      help="Bestätigt die Berechtigung für diesen irreversiblen Vorgang. Die PIN wird nicht protokolliert."
                    />
                    <input
                      autoComplete="current-password"
                      onChange={(event) => setFactoryResetPin(event.target.value)}
                      type="password"
                      value={factoryResetPin}
                    />
                  </label>
                ) : null}
                <label>
                  <FieldLabel
                    label="Sicherheitsbestätigung"
                    help="Zum Schutz vor versehentlicher Ausführung muss WERKSZUSTAND vollständig eingegeben werden."
                  />
                  <input
                    autoComplete="off"
                    onChange={(event) => setFactoryResetConfirmation(event.target.value)}
                    value={factoryResetConfirmation}
                  />
                </label>
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
                  <button
                    className="danger-action"
                    disabled={
                      factoryResetBusy ||
                      factoryResetReason.trim().length < 3 ||
                      factoryResetPin.length < 4 ||
                      factoryResetConfirmation !== "WERKSZUSTAND"
                    }
                    onClick={() => void performFactoryReset()}
                    type="button"
                  >
                    {factoryResetBusy
                      ? "System wird zurückgesetzt …"
                      : "Alles löschen und neu starten"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}
          {message ? (
            <div className="action-message admin-action-message" role="status">
              <span>{message}</span>
              <button aria-label="Hinweis schließen" onClick={() => setMessage(null)} type="button">
                ×
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </Shell>
  );
}
