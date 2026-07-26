import type { CommandEnvelope, OperationBoard } from "@rundflug/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  ModalDialog,
  SelectField,
  Tabs,
  TextAreaField,
  TextField,
} from "../../design-system/components";
import { eventLocalDateTimeToIso, formatEventLocalDateTime } from "../../event-time";

type OperationsTab = "operations" | "plan" | "resources";
type ResourceGroup = OperationBoard["resourceGroups"][number];
type PlannedOperation = OperationBoard["plannedOperations"][number];
type UpsertPlannedOperationPayload = Extract<
  CommandEnvelope,
  { type: "UPSERT_PLANNED_OPERATION" }
>["payload"];
type ResourceGroupStatus = "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
type NoticeEditorTarget = { kind: "event" } | { kind: "resource"; resourceGroupId: string };

const operationsTabs: Array<{ value: OperationsTab; label: string }> = [
  { value: "operations", label: "Betrieb" },
  { value: "plan", label: "Betriebsplan" },
  { value: "resources", label: "Ressourcengruppen" },
];

const resourceStatusActions: Array<{ status: ResourceGroupStatus; label: string }> = [
  { status: "ACTIVE", label: "Aktiv" },
  { status: "PAUSED", label: "Pause" },
  { status: "INTERRUPTED", label: "Unterbrochen" },
];
const endedStatusAction = { status: "ENDED", label: "Beendet" } as const;

export interface FlightDirectorOperationsDialogProps {
  busy: boolean;
  emergencyMode: boolean;
  eventInterrupted: boolean;
  eventId: string;
  eventNotice: string;
  eventTimeZone: string;
  open: boolean;
  aircraft: OperationBoard["aircraft"];
  pilots: OperationBoard["pilots"];
  plannedOperations: OperationBoard["plannedOperations"];
  rotations: OperationBoard["rotations"];
  resourceGroups: ResourceGroup[];
  onCancelPlannedOperation: (plan: PlannedOperation) => Promise<void>;
  onClose: () => void;
  onConfirmPlannedOperation: (plan: PlannedOperation, activate: boolean) => Promise<void>;
  onPublishEventNotice: (notice: string) => Promise<boolean>;
  onPublishResourceNotice: (resourceGroupId: string, notice: string) => Promise<boolean>;
  onSetEventInterruption: (interrupted: boolean) => Promise<void>;
  onSetResourceGroupStatus: (resourceGroupId: string, status: ResourceGroupStatus) => Promise<void>;
  onTriggerEmergency: () => Promise<void>;
  onUpsertPlannedOperation: (payload: UpsertPlannedOperationPayload) => Promise<void>;
}

interface OperationalNoticeEditorProps {
  busy: boolean;
  context?: { name: string; shortCode: string };
  draft: string;
  help: string;
  published: boolean;
  onChange: (draft: string) => void;
  onDelete: () => Promise<void>;
  onSave: () => Promise<void>;
}

function OperationalNoticeEditor({
  busy,
  context,
  draft,
  help,
  published,
  onChange,
  onDelete,
  onSave,
}: OperationalNoticeEditorProps) {
  return (
    <div className="flight-director-notice-editor">
      {context ? (
        <div className="flight-director-notice-context">
          <strong>{context.name}</strong>
          <span>{context.shortCode}</span>
        </div>
      ) : null}
      <TextAreaField
        autoFocus
        help={help}
        label="Hinweis"
        maxLength={240}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        value={draft}
      />
      <div className="flight-director-notice-edit-actions">
        {published ? (
          <Button disabled={busy} onClick={onDelete} type="button" variant="danger">
            Löschen
          </Button>
        ) : null}
        <Button
          disabled={busy || draft.trim().length === 0}
          onClick={onSave}
          type="button"
          variant="primary"
        >
          {published ? "Speichern" : "Hinweis veröffentlichen"}
        </Button>
      </div>
    </div>
  );
}

export function FlightDirectorOperationsDialog({
  aircraft,
  busy,
  emergencyMode,
  eventId,
  eventInterrupted,
  eventNotice,
  eventTimeZone,
  open,
  pilots,
  plannedOperations,
  resourceGroups,
  rotations,
  onCancelPlannedOperation,
  onClose,
  onConfirmPlannedOperation,
  onPublishEventNotice,
  onPublishResourceNotice,
  onSetEventInterruption,
  onSetResourceGroupStatus,
  onTriggerEmergency,
  onUpsertPlannedOperation,
}: FlightDirectorOperationsDialogProps) {
  const [tab, setTab] = useState<OperationsTab>("operations");
  const [noticeTarget, setNoticeTarget] = useState<NoticeEditorTarget | null>(null);
  const [noticeDraft, setNoticeDraft] = useState("");
  const [planEditorId, setPlanEditorId] = useState<string | null>(null);
  const [planExpectedVersion, setPlanExpectedVersion] = useState<number | null>(null);
  const [planScopeType, setPlanScopeType] = useState<PlannedOperation["scopeType"]>("EVENT");
  const [planScopeId, setPlanScopeId] = useState(eventId);
  const [planKind, setPlanKind] = useState<PlannedOperation["kind"]>("PAUSE");
  const [planStartMode, setPlanStartMode] = useState<PlannedOperation["startMode"]>("TIME_WINDOW");
  const [planEarliestStart, setPlanEarliestStart] = useState("");
  const [planLatestStart, setPlanLatestStart] = useState("");
  const [planAfterRotationId, setPlanAfterRotationId] = useState("");
  const [planMinimumDuration, setPlanMinimumDuration] = useState(10);
  const [planTypicalDuration, setPlanTypicalDuration] = useState(20);
  const [planMaximumDuration, setPlanMaximumDuration] = useState(30);
  const [planReason, setPlanReason] = useState("Organisatorisch eingeplante Einschränkung");
  const [planPublicNote, setPlanPublicNote] = useState("");
  const openedRef = useRef(false);
  const selectedResourceGroup =
    noticeTarget?.kind === "resource"
      ? (resourceGroups.find((group) => group.id === noticeTarget.resourceGroupId) ?? null)
      : null;
  const noticeEditorOpen = noticeTarget?.kind === "event" || selectedResourceGroup !== null;
  const publishedEventNotice = eventNotice.trim();
  const publishedNotice =
    noticeTarget?.kind === "event"
      ? publishedEventNotice
      : (selectedResourceGroup?.operationalNote?.trim() ?? "");
  const currentPlans = plannedOperations.filter((plan) =>
    ["PLANNED", "DUE", "ACTIVE"].includes(plan.status),
  );

  const resetPlanEditor = useCallback(() => {
    const earliest = new Date(Date.now() + 60 * 60_000).toISOString();
    const latest = new Date(Date.now() + 75 * 60_000).toISOString();
    setPlanEditorId(null);
    setPlanExpectedVersion(null);
    setPlanScopeType("EVENT");
    setPlanScopeId(eventId);
    setPlanKind("PAUSE");
    setPlanStartMode("TIME_WINDOW");
    setPlanEarliestStart(formatEventLocalDateTime(earliest, eventTimeZone));
    setPlanLatestStart(formatEventLocalDateTime(latest, eventTimeZone));
    setPlanAfterRotationId("");
    setPlanMinimumDuration(10);
    setPlanTypicalDuration(20);
    setPlanMaximumDuration(30);
    setPlanReason("Organisatorisch eingeplante Einschränkung");
    setPlanPublicNote("");
  }, [eventId, eventTimeZone]);

  useEffect(() => {
    if (open && !openedRef.current) {
      setTab("operations");
      setNoticeTarget(null);
      setNoticeDraft("");
      resetPlanEditor();
    }
    openedRef.current = open;
  }, [open, resetPlanEditor]);

  function editPlannedOperation(plan: PlannedOperation) {
    setPlanEditorId(plan.id);
    setPlanExpectedVersion(plan.version);
    setPlanScopeType(plan.scopeType);
    setPlanScopeId(plan.scopeId);
    setPlanKind(plan.kind);
    setPlanStartMode(plan.startMode);
    setPlanEarliestStart(formatEventLocalDateTime(plan.earliestStartAt, eventTimeZone));
    setPlanLatestStart(formatEventLocalDateTime(plan.latestStartAt, eventTimeZone));
    setPlanAfterRotationId(plan.afterRotationId ?? "");
    setPlanMinimumDuration(plan.minimumDurationMinutes);
    setPlanTypicalDuration(plan.typicalDurationMinutes);
    setPlanMaximumDuration(plan.maximumDurationMinutes);
    setPlanReason(plan.reason);
    setPlanPublicNote(plan.publicNote);
  }

  async function savePlannedOperation() {
    const planId = planEditorId ?? crypto.randomUUID();
    await onUpsertPlannedOperation({
      planId,
      planExpectedVersion,
      scopeType: planScopeType,
      scopeId: planScopeType === "EVENT" ? eventId : planScopeId,
      kind: planKind,
      startMode: planStartMode,
      earliestStartAt:
        planStartMode === "TIME_WINDOW"
          ? eventLocalDateTimeToIso(planEarliestStart, eventTimeZone)
          : null,
      latestStartAt:
        planStartMode === "TIME_WINDOW"
          ? eventLocalDateTimeToIso(planLatestStart, eventTimeZone)
          : null,
      afterRotationId: planStartMode === "AFTER_CURRENT_ROTATION" ? planAfterRotationId : null,
      minimumDurationMinutes: planMinimumDuration,
      typicalDurationMinutes: planTypicalDuration,
      maximumDurationMinutes: planMaximumDuration,
      reason: planReason.trim(),
      publicNote: planPublicNote.trim(),
    });
    resetPlanEditor();
  }

  function editEventNotice() {
    setNoticeTarget({ kind: "event" });
    setNoticeDraft(eventNotice);
  }

  function editResourceNotice(group: ResourceGroup) {
    setNoticeTarget({ kind: "resource", resourceGroupId: group.id });
    setNoticeDraft(group.operationalNote ?? "");
  }

  function returnFromNoticeEditor() {
    const nextTab = noticeTarget?.kind === "resource" ? "resources" : "operations";
    setNoticeTarget(null);
    setNoticeDraft("");
    setTab(nextTab);
  }

  async function saveNotice() {
    if (!noticeTarget) return;
    const saved =
      noticeTarget.kind === "event"
        ? await onPublishEventNotice(noticeDraft.trim())
        : await onPublishResourceNotice(noticeTarget.resourceGroupId, noticeDraft.trim());
    if (saved) returnFromNoticeEditor();
  }

  async function deleteNotice() {
    if (!noticeTarget) return;
    const saved =
      noticeTarget.kind === "event"
        ? await onPublishEventNotice("")
        : await onPublishResourceNotice(noticeTarget.resourceGroupId, "");
    if (saved) returnFromNoticeEditor();
  }

  const planTargets =
    planScopeType === "RESOURCE_GROUP"
      ? resourceGroups.map((group) => ({ value: group.id, label: group.name }))
      : planScopeType === "AIRCRAFT"
        ? aircraft.map((entry) => ({ value: entry.id, label: entry.registration }))
        : planScopeType === "PILOT"
          ? pilots.map((pilot) => ({ value: pilot.id, label: pilot.operationalCode }))
          : [{ value: eventId, label: "Gesamte Veranstaltung" }];
  const planScopeLabel = (plan: PlannedOperation) =>
    plan.scopeType === "EVENT"
      ? "Gesamte Veranstaltung"
      : plan.scopeType === "RESOURCE_GROUP"
        ? (resourceGroups.find((group) => group.id === plan.scopeId)?.name ?? plan.scopeId)
        : plan.scopeType === "AIRCRAFT"
          ? (aircraft.find((entry) => entry.id === plan.scopeId)?.registration ?? plan.scopeId)
          : (pilots.find((pilot) => pilot.id === plan.scopeId)?.operationalCode ?? plan.scopeId);
  const planKindLabel: Record<PlannedOperation["kind"], string> = {
    PAUSE: "Pause",
    REFUELING: "Tanken",
    FLIGHT_SHOW: "Flugshow",
    WEATHER: "Wetter",
    TECHNICAL: "Technik",
    OTHER: "Sonstiges",
  };
  const eligiblePlanRotations = rotations.filter((rotation) => {
    if (!["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status)) return false;
    if (planScopeType === "EVENT") return true;
    if (planScopeType === "AIRCRAFT") return rotation.aircraftId === planScopeId;
    if (planScopeType === "PILOT") return rotation.pilotId === planScopeId;
    const group = resourceGroups.find((entry) => entry.id === planScopeId);
    return (
      rotation.aircraftId !== null &&
      Boolean(group?.activeAircraftIds.includes(rotation.aircraftId))
    );
  });
  const canSavePlan =
    planReason.trim().length >= 3 &&
    planMinimumDuration >= 1 &&
    planMinimumDuration <= planTypicalDuration &&
    planTypicalDuration <= planMaximumDuration &&
    (planScopeType === "EVENT" || planScopeId.length > 0) &&
    (planStartMode === "TIME_WINDOW"
      ? planEarliestStart.length > 0 && planLatestStart.length > 0
      : eligiblePlanRotations.some((rotation) => rotation.id === planAfterRotationId));

  return (
    <ModalDialog
      description={
        noticeTarget?.kind === "event"
          ? "Der Hinweis gilt veranstaltungsweit und hat Vorrang vor Hinweisen einzelner Ressourcengruppen."
          : selectedResourceGroup
            ? "Der Hinweis gilt ausschließlich für diese Ressourcengruppe."
            : "Organisatorische Betriebslage steuern. Keine Aktion besitzt flugbetriebliche oder sicherheitsbezogene Freigabewirkung."
      }
      footer={
        <Button
          onClick={noticeEditorOpen ? returnFromNoticeEditor : onClose}
          type="button"
          variant="secondary"
        >
          {noticeEditorOpen ? "Zurück" : "Schließen"}
        </Button>
      }
      onClose={onClose}
      open={open}
      size="wide"
      title={
        noticeTarget?.kind === "event"
          ? "Veranstaltungsweiter Hinweis"
          : selectedResourceGroup
            ? `Hinweis für ${selectedResourceGroup.name}`
            : "Betrieb steuern"
      }
    >
      {noticeEditorOpen ? (
        <OperationalNoticeEditor
          busy={busy}
          draft={noticeDraft}
          help={
            noticeTarget?.kind === "event"
              ? "Maximal 240 Zeichen. Der Hinweis wird veranstaltungsweit veröffentlicht."
              : "Maximal 240 Zeichen. Der Hinweis wird in den operativen Ansichten dieser Ressourcengruppe angezeigt."
          }
          onChange={setNoticeDraft}
          onDelete={deleteNotice}
          onSave={saveNotice}
          published={publishedNotice.length > 0}
          {...(selectedResourceGroup
            ? {
                context: {
                  name: selectedResourceGroup.name,
                  shortCode: selectedResourceGroup.shortCode,
                },
              }
            : {})}
        />
      ) : (
        <div className="flight-director-operations-dialog">
          <Tabs items={operationsTabs} label="Betriebssteuerung" onChange={setTab} value={tab} />
          {tab === "operations" ? (
            <div className="flight-director-operation-panel" role="tabpanel">
              <section className="flight-director-event-notice-summary">
                <div>
                  <h3>Veranstaltungsweiter Hinweis</h3>
                  <p>
                    {publishedEventNotice
                      ? "Hinweis veröffentlicht"
                      : "Kein Hinweis veröffentlicht"}
                  </p>
                </div>
                <Button
                  className="flight-director-notice-action"
                  disabled={busy}
                  onClick={editEventNotice}
                  size="compact"
                  type="button"
                  variant="secondary"
                >
                  {publishedEventNotice ? "Hinweis bearbeiten" : "Hinweis veröffentlichen"}
                </Button>
              </section>
              <section className="flight-director-interruption">
                <div>
                  <h3>Veranstaltungsbetrieb</h3>
                  <p>
                    Aktuell: <strong>{eventInterrupted ? "unterbrochen" : "laufend"}</strong>
                  </p>
                </div>
                <Button
                  disabled={busy}
                  onClick={() => onSetEventInterruption(!eventInterrupted)}
                  type="button"
                  variant={eventInterrupted ? "primary" : "danger"}
                >
                  {eventInterrupted ? "Betrieb fortsetzen" : "Betrieb unterbrechen"}
                </Button>
              </section>
              <section className="flight-director-emergency-panel">
                <div className={emergencyMode ? "active" : ""}>
                  <strong>{emergencyMode ? "Not-Halt aktiv" : "Kein Not-Halt aktiv"}</strong>
                  <p>
                    Der Not-Halt stoppt operative Kommandos. Die Aufhebung bleibt ausschließlich im
                    Admin-Bereich möglich.
                  </p>
                </div>
                {!emergencyMode ? (
                  <Button
                    disabled={busy}
                    onClick={onTriggerEmergency}
                    type="button"
                    variant="danger"
                  >
                    Not-Halt auslösen
                  </Button>
                ) : null}
              </section>
            </div>
          ) : tab === "plan" ? (
            <div className="flight-director-plan-panel" role="tabpanel">
              <section className="flight-director-plan-list">
                <div>
                  <h3>Geplante Einschränkungen</h3>
                  <p>
                    Zeitfenster sind bewusst ungefähr. Fällig bedeutet nur „prüfen“; Start und Ende
                    werden immer bestätigt.
                  </p>
                </div>
                {currentPlans.length === 0 ? (
                  <p>Noch keine Einschränkung geplant.</p>
                ) : (
                  currentPlans.map((plan) => (
                    <article key={plan.id}>
                      <div>
                        <strong>
                          {planKindLabel[plan.kind]} · {planScopeLabel(plan)}
                        </strong>
                        <span>
                          {plan.startMode === "TIME_WINDOW"
                            ? `${formatEventLocalDateTime(plan.earliestStartAt, eventTimeZone).replace("T", " ")}–${formatEventLocalDateTime(plan.latestStartAt, eventTimeZone).replace("T", " ")}`
                            : "Nach dem gewählten Umlauf"}
                        </span>
                        <small>
                          {plan.minimumDurationMinutes}/{plan.typicalDurationMinutes}/
                          {plan.maximumDurationMinutes} Min. · {plan.reason}
                        </small>
                      </div>
                      <span className={`operation-status status-${plan.status.toLowerCase()}`}>
                        {plan.status === "DUE"
                          ? "Fällig"
                          : plan.status === "ACTIVE"
                            ? "Läuft"
                            : "Geplant"}
                      </span>
                      <div className="flight-director-plan-actions">
                        {plan.status === "PLANNED" || plan.status === "DUE" ? (
                          <>
                            <Button
                              disabled={busy}
                              onClick={() => editPlannedOperation(plan)}
                              size="compact"
                              type="button"
                              variant="secondary"
                            >
                              Bearbeiten
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() => onCancelPlannedOperation(plan)}
                              size="compact"
                              type="button"
                              variant="secondary"
                            >
                              Absagen
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() => onConfirmPlannedOperation(plan, true)}
                              size="compact"
                              type="button"
                              variant="primary"
                            >
                              Start bestätigen
                            </Button>
                          </>
                        ) : (
                          <Button
                            disabled={busy}
                            onClick={() => onConfirmPlannedOperation(plan, false)}
                            size="compact"
                            type="button"
                            variant="primary"
                          >
                            Ende bestätigen
                          </Button>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </section>
              <section className="flight-director-plan-editor">
                <div>
                  <h3>{planEditorId ? "Planeintrag bearbeiten" : "Einschränkung einplanen"}</h3>
                  <p>Interne Planung ohne automatische Zustandsänderung.</p>
                </div>
                <div className="flight-director-plan-grid">
                  <SelectField
                    label="Geltungsbereich"
                    onChange={(event) => {
                      const value = event.target.value as PlannedOperation["scopeType"];
                      setPlanScopeType(value);
                      const firstTarget =
                        value === "EVENT"
                          ? eventId
                          : value === "RESOURCE_GROUP"
                            ? resourceGroups[0]?.id
                            : value === "AIRCRAFT"
                              ? aircraft[0]?.id
                              : pilots[0]?.id;
                      setPlanScopeId(firstTarget ?? "");
                      setPlanAfterRotationId("");
                      if (!["EVENT", "RESOURCE_GROUP"].includes(value)) setPlanPublicNote("");
                    }}
                    value={planScopeType}
                  >
                    <option value="EVENT">Veranstaltung</option>
                    <option value="RESOURCE_GROUP">Ressourcengruppe</option>
                    <option value="AIRCRAFT">Flugzeug</option>
                    <option value="PILOT">Pilotencode</option>
                  </SelectField>
                  <SelectField
                    disabled={planScopeType === "EVENT"}
                    label="Ziel"
                    onChange={(event) => {
                      setPlanScopeId(event.target.value);
                      setPlanAfterRotationId("");
                    }}
                    value={planScopeId}
                  >
                    {planTargets.map((target) => (
                      <option key={target.value} value={target.value}>
                        {target.label}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label="Art"
                    onChange={(event) =>
                      setPlanKind(event.target.value as PlannedOperation["kind"])
                    }
                    value={planKind}
                  >
                    {Object.entries(planKindLabel).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label="Beginn"
                    onChange={(event) =>
                      setPlanStartMode(event.target.value as PlannedOperation["startMode"])
                    }
                    value={planStartMode}
                  >
                    <option value="TIME_WINDOW">Ungefähres Zeitfenster</option>
                    <option value="AFTER_CURRENT_ROTATION">Nach einem Umlauf</option>
                  </SelectField>
                  {planStartMode === "TIME_WINDOW" ? (
                    <>
                      <TextField
                        label="Frühester Beginn"
                        onChange={(event) => setPlanEarliestStart(event.target.value)}
                        type="datetime-local"
                        value={planEarliestStart}
                      />
                      <TextField
                        label="Spätester Beginn"
                        onChange={(event) => setPlanLatestStart(event.target.value)}
                        type="datetime-local"
                        value={planLatestStart}
                      />
                    </>
                  ) : (
                    <SelectField
                      label="Bezugsumlauf"
                      onChange={(event) => setPlanAfterRotationId(event.target.value)}
                      value={planAfterRotationId}
                    >
                      <option value="">Umlauf wählen</option>
                      {eligiblePlanRotations.map((rotation) => (
                        <option key={rotation.id} value={rotation.id}>
                          {rotation.communicationLabel} · {rotation.status}
                        </option>
                      ))}
                    </SelectField>
                  )}
                  <TextField
                    label="Dauer Minimum (Min.)"
                    min="1"
                    onChange={(event) => setPlanMinimumDuration(Number(event.target.value))}
                    type="number"
                    value={planMinimumDuration}
                  />
                  <TextField
                    label="Dauer typisch (Min.)"
                    min="1"
                    onChange={(event) => setPlanTypicalDuration(Number(event.target.value))}
                    type="number"
                    value={planTypicalDuration}
                  />
                  <TextField
                    label="Dauer Maximum (Min.)"
                    min="1"
                    onChange={(event) => setPlanMaximumDuration(Number(event.target.value))}
                    type="number"
                    value={planMaximumDuration}
                  />
                </div>
                <TextAreaField
                  label="Interner Grund"
                  maxLength={240}
                  onChange={(event) => setPlanReason(event.target.value)}
                  rows={2}
                  value={planReason}
                />
                <TextField
                  disabled={!["EVENT", "RESOURCE_GROUP"].includes(planScopeType)}
                  help="Optional und neutral formuliert; keine interne Ursache veröffentlichen."
                  label="Öffentlicher Hinweis"
                  maxLength={160}
                  onChange={(event) => setPlanPublicNote(event.target.value)}
                  value={planPublicNote}
                />
                <div className="flight-director-plan-editor-actions">
                  {planEditorId ? (
                    <Button onClick={resetPlanEditor} type="button" variant="secondary">
                      Bearbeitung abbrechen
                    </Button>
                  ) : null}
                  <Button
                    disabled={busy || !canSavePlan}
                    onClick={savePlannedOperation}
                    type="button"
                    variant="primary"
                  >
                    {planEditorId ? "Änderung speichern" : "Einplanen"}
                  </Button>
                </div>
              </section>
            </div>
          ) : (
            <div className="flight-director-operation-list" role="tabpanel">
              {resourceGroups.map((group) => (
                <article key={group.id}>
                  <div>
                    <strong>{group.name}</strong>
                    <span>{group.shortCode}</span>
                    <small>
                      {group.activeAircraftIds.length} Flugzeuge
                      {group.operationalNote ? " · Hinweis veröffentlicht" : ""}
                    </small>
                  </div>
                  <span className={`operation-status status-${group.status.toLowerCase()}`}>
                    {group.status}
                  </span>
                  <div className="flight-director-operation-actions">
                    {resourceStatusActions.map(({ status, label }) => (
                      <Button
                        disabled={busy || group.status === status}
                        key={status}
                        onClick={() => onSetResourceGroupStatus(group.id, status)}
                        size="compact"
                        type="button"
                        variant="secondary"
                      >
                        {label}
                      </Button>
                    ))}
                    <Button
                      className="flight-director-notice-action"
                      disabled={busy}
                      onClick={() => editResourceNotice(group)}
                      size="compact"
                      type="button"
                      variant="secondary"
                    >
                      {group.operationalNote ? "Hinweis bearbeiten" : "Hinweis veröffentlichen"}
                    </Button>
                    <Button
                      disabled={busy || group.status === endedStatusAction.status}
                      onClick={() => onSetResourceGroupStatus(group.id, endedStatusAction.status)}
                      size="compact"
                      type="button"
                      variant="danger"
                    >
                      {endedStatusAction.label}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </ModalDialog>
  );
}
