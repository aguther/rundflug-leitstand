import type { CommandEnvelope, OperationBoard } from "@rundflug/contracts";
import { Ban, CalendarClock, Pencil, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  Button,
  ConfirmationDialog,
  DataTable,
  IconButton,
  ModalDialog,
  SelectField,
  StatusPill,
  TextField,
} from "../../design-system/components";
import { eventLocalDateTimeToIso, formatEventLocalDateTime } from "../../event-time";
import { LocalizedDateTimeInput } from "../../localized-date-input";
import "./operational-plan.css";

export type PlannedOperation = OperationBoard["plannedOperations"][number];
export type RecurringOperationalRule = OperationBoard["recurringOperationalRules"][number];
export type UpsertPlannedOperationPayload = Extract<
  CommandEnvelope,
  { type: "UPSERT_PLANNED_OPERATION" }
>["payload"];
export type UpsertRecurringOperationalRulePayload = Extract<
  CommandEnvelope,
  { type: "UPSERT_RECURRING_OPERATIONAL_RULE" }
>["payload"];

type OperationalPlanMode = "admin" | "flight-director";
export type OperationalPlanContent = "combined" | "plans" | "rules";

export interface OperationalPlanPanelProps {
  aircraft: OperationBoard["aircraft"];
  busy: boolean;
  eventId: string;
  eventTimeZone: string;
  mode: OperationalPlanMode;
  content?: OperationalPlanContent;
  pilots: OperationBoard["pilots"];
  plannedOperations: OperationBoard["plannedOperations"];
  recurringOperationalRules: OperationBoard["recurringOperationalRules"];
  readOnly?: boolean;
  resourceGroups: OperationBoard["resourceGroups"];
  rotations: OperationBoard["rotations"];
  onCancel: (plan: PlannedOperation) => Promise<void>;
  onConfirm?: (plan: PlannedOperation, activate: boolean) => Promise<void>;
  onDisableRecurringRule: (rule: RecurringOperationalRule) => Promise<void>;
  onUpsert: (payload: UpsertPlannedOperationPayload) => Promise<void>;
  onUpsertRecurringRule: (payload: UpsertRecurringOperationalRulePayload) => Promise<void>;
}

const planKindLabels: Record<PlannedOperation["kind"], string> = {
  PAUSE: "Pause",
  REFUELING: "Tanken",
  FLIGHT_SHOW: "Flugshow",
  WEATHER: "Wetter",
  TECHNICAL: "Technik",
  OTHER: "Sonstiges",
};

const planStatusLabels: Record<PlannedOperation["status"], string> = {
  PLANNED: "Geplant",
  DUE: "Fällig",
  ACTIVE: "Aktiv",
  CLEARED: "Beendet",
  CANCELED: "Abgesagt",
};

function planStatusTone(
  status: PlannedOperation["status"],
): "neutral" | "info" | "success" | "warning" {
  if (status === "ACTIVE" || status === "CLEARED") return "success";
  if (status === "DUE") return "warning";
  if (status === "PLANNED") return "info";
  return "neutral";
}

function localPlanTime(value: string | null, timeZone: string) {
  if (!value) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

export function OperationalPlanPanel({
  aircraft,
  busy,
  eventId,
  eventTimeZone,
  mode,
  content = "combined",
  pilots,
  plannedOperations,
  recurringOperationalRules,
  readOnly = false,
  resourceGroups,
  rotations,
  onCancel,
  onConfirm,
  onDisableRecurringRule,
  onUpsert,
  onUpsertRecurringRule,
}: OperationalPlanPanelProps) {
  const showPlans = content === "combined" || content === "plans";
  const showRules = content === "combined" || content === "rules";
  const [editorOpen, setEditorOpen] = useState(false);
  const [planEditorId, setPlanEditorId] = useState<string | null>(null);
  const [planExpectedVersion, setPlanExpectedVersion] = useState<number | null>(null);
  const [planScopeType, setPlanScopeType] = useState<PlannedOperation["scopeType"]>("EVENT");
  const [planScopeId, setPlanScopeId] = useState(eventId);
  const [planKind, setPlanKind] = useState<PlannedOperation["kind"]>("PAUSE");
  const [planEffectMode, setPlanEffectMode] = useState<PlannedOperation["effectMode"]>("BLOCKING");
  const [planDurationMultiplierPercent, setPlanDurationMultiplierPercent] = useState(150);
  const [planStartMode, setPlanStartMode] = useState<PlannedOperation["startMode"]>("TIME_WINDOW");
  const [planEarliestStart, setPlanEarliestStart] = useState("");
  const [planLatestStart, setPlanLatestStart] = useState("");
  const [planAfterRotationId, setPlanAfterRotationId] = useState("");
  const [planMinimumDuration, setPlanMinimumDuration] = useState(10);
  const [planTypicalDuration, setPlanTypicalDuration] = useState(20);
  const [planMaximumDuration, setPlanMaximumDuration] = useState(30);
  const [planPublicNote, setPlanPublicNote] = useState("");
  const [pendingCancel, setPendingCancel] = useState<PlannedOperation | null>(null);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [ruleEditorId, setRuleEditorId] = useState<string | null>(null);
  const [ruleExpectedVersion, setRuleExpectedVersion] = useState<number | null>(null);
  const [ruleScopeType, setRuleScopeType] =
    useState<RecurringOperationalRule["scopeType"]>("AIRCRAFT");
  const [ruleScopeId, setRuleScopeId] = useState(aircraft[0]?.id ?? "");
  const [ruleKind, setRuleKind] = useState<RecurringOperationalRule["kind"]>("REFUELING");
  const [ruleTrigger, setRuleTrigger] =
    useState<RecurringOperationalRule["triggerMetric"]>("COMPLETED_ROTATIONS");
  const [ruleInterval, setRuleInterval] = useState(aircraft[0]?.refuelReminderThreshold ?? 5);
  const [ruleMinimumDuration, setRuleMinimumDuration] = useState(8);
  const [ruleTypicalDuration, setRuleTypicalDuration] = useState(12);
  const [ruleMaximumDuration, setRuleMaximumDuration] = useState(18);
  const [pendingRuleDisable, setPendingRuleDisable] = useState<RecurringOperationalRule | null>(
    null,
  );

  const currentPlans = useMemo(
    () =>
      plannedOperations
        .filter((plan) => ["PLANNED", "DUE", "ACTIVE"].includes(plan.status))
        .toSorted((left, right) => {
          const leftTime = left.earliestStartAt
            ? Date.parse(left.earliestStartAt)
            : Number.MAX_VALUE;
          const rightTime = right.earliestStartAt
            ? Date.parse(right.earliestStartAt)
            : Number.MAX_VALUE;
          return leftTime - rightTime;
        }),
    [plannedOperations],
  );

  const resetPlanEditor = useCallback(() => {
    const earliest = new Date(Date.now() + 60 * 60_000).toISOString();
    const latest = new Date(Date.now() + 75 * 60_000).toISOString();
    setPlanEditorId(null);
    setPlanExpectedVersion(null);
    setPlanScopeType("EVENT");
    setPlanScopeId(eventId);
    setPlanKind("PAUSE");
    setPlanEffectMode("BLOCKING");
    setPlanDurationMultiplierPercent(150);
    setPlanStartMode("TIME_WINDOW");
    setPlanEarliestStart(formatEventLocalDateTime(earliest, eventTimeZone));
    setPlanLatestStart(formatEventLocalDateTime(latest, eventTimeZone));
    setPlanAfterRotationId("");
    setPlanMinimumDuration(10);
    setPlanTypicalDuration(20);
    setPlanMaximumDuration(30);
    setPlanPublicNote("");
  }, [eventId, eventTimeZone]);

  const resetRuleEditor = useCallback(() => {
    const target = aircraft[0];
    setRuleEditorId(null);
    setRuleExpectedVersion(null);
    setRuleScopeType(target ? "AIRCRAFT" : "PILOT");
    setRuleScopeId(target?.id ?? pilots[0]?.id ?? "");
    setRuleKind(target ? "REFUELING" : "PAUSE");
    setRuleTrigger(target ? "COMPLETED_ROTATIONS" : "OPERATING_MINUTES");
    setRuleInterval(target?.refuelReminderThreshold ?? 5);
    setRuleMinimumDuration(target ? 8 : 15);
    setRuleTypicalDuration(target ? 12 : 20);
    setRuleMaximumDuration(target ? 18 : 30);
  }, [aircraft, pilots]);

  function openNewPlan() {
    resetPlanEditor();
    setEditorOpen(true);
  }

  function editPlannedOperation(plan: PlannedOperation) {
    setPlanEditorId(plan.id);
    setPlanExpectedVersion(plan.version);
    setPlanScopeType(plan.scopeType);
    setPlanScopeId(plan.scopeId);
    setPlanKind(plan.kind);
    setPlanEffectMode(plan.effectMode);
    setPlanDurationMultiplierPercent(plan.durationMultiplierPercent ?? 150);
    setPlanStartMode(plan.startMode);
    setPlanEarliestStart(formatEventLocalDateTime(plan.earliestStartAt, eventTimeZone));
    setPlanLatestStart(formatEventLocalDateTime(plan.latestStartAt, eventTimeZone));
    setPlanAfterRotationId(plan.afterRotationId ?? "");
    setPlanMinimumDuration(plan.minimumDurationMinutes);
    setPlanTypicalDuration(plan.typicalDurationMinutes);
    setPlanMaximumDuration(plan.maximumDurationMinutes);
    setPlanPublicNote(plan.publicNote);
    setEditorOpen(true);
  }

  function openNewRule() {
    resetRuleEditor();
    setRuleEditorOpen(true);
  }

  function editRecurringRule(rule: RecurringOperationalRule) {
    setRuleEditorId(rule.id);
    setRuleExpectedVersion(rule.version);
    setRuleScopeType(rule.scopeType);
    setRuleScopeId(rule.scopeId);
    setRuleKind(rule.kind);
    setRuleTrigger(rule.triggerMetric);
    setRuleInterval(rule.intervalValue);
    setRuleMinimumDuration(rule.minimumDurationMinutes);
    setRuleTypicalDuration(rule.typicalDurationMinutes);
    setRuleMaximumDuration(rule.maximumDurationMinutes);
    setRuleEditorOpen(true);
  }

  const planTargets =
    planScopeType === "RESOURCE_GROUP"
      ? resourceGroups.map((group) => ({ value: group.id, label: group.name }))
      : planScopeType === "AIRCRAFT"
        ? aircraft.map((entry) => ({ value: entry.id, label: entry.registration }))
        : planScopeType === "PILOT"
          ? pilots.map((pilot) => ({ value: pilot.id, label: pilot.operationalCode }))
          : [{ value: eventId, label: "Gesamte Veranstaltung" }];
  const ruleTargets =
    ruleScopeType === "AIRCRAFT"
      ? aircraft.map((entry) => ({ value: entry.id, label: entry.registration }))
      : pilots.map((entry) => ({ value: entry.id, label: entry.operationalCode }));

  function planScopeLabel(plan: PlannedOperation) {
    if (plan.scopeType === "EVENT") return "Gesamte Veranstaltung";
    if (plan.scopeType === "RESOURCE_GROUP")
      return resourceGroups.find((group) => group.id === plan.scopeId)?.name ?? plan.scopeId;
    if (plan.scopeType === "AIRCRAFT")
      return aircraft.find((entry) => entry.id === plan.scopeId)?.registration ?? plan.scopeId;
    return pilots.find((pilot) => pilot.id === plan.scopeId)?.operationalCode ?? plan.scopeId;
  }

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

  const earliestIso =
    planStartMode === "TIME_WINDOW" && planEarliestStart
      ? eventLocalDateTimeToIso(planEarliestStart, eventTimeZone)
      : null;
  const latestIso =
    planStartMode === "TIME_WINDOW" && planLatestStart
      ? eventLocalDateTimeToIso(planLatestStart, eventTimeZone)
      : null;
  const canSavePlan =
    planMinimumDuration >= 1 &&
    planMinimumDuration <= planTypicalDuration &&
    planTypicalDuration <= planMaximumDuration &&
    (planEffectMode === "BLOCKING" ||
      (planDurationMultiplierPercent >= 110 && planDurationMultiplierPercent <= 300)) &&
    (planScopeType === "EVENT" || planScopeId.length > 0) &&
    (planStartMode === "TIME_WINDOW"
      ? Boolean(earliestIso && latestIso && Date.parse(earliestIso) <= Date.parse(latestIso))
      : eligiblePlanRotations.some((rotation) => rotation.id === planAfterRotationId));

  async function savePlannedOperation() {
    await onUpsert({
      planId: planEditorId ?? crypto.randomUUID(),
      planExpectedVersion,
      scopeType: planScopeType,
      scopeId: planScopeType === "EVENT" ? eventId : planScopeId,
      kind: planKind,
      effectMode: planEffectMode,
      durationMultiplierPercent:
        planEffectMode === "SLOWDOWN" ? planDurationMultiplierPercent : null,
      startMode: planStartMode,
      earliestStartAt: earliestIso,
      latestStartAt: latestIso,
      afterRotationId: planStartMode === "AFTER_CURRENT_ROTATION" ? planAfterRotationId : null,
      minimumDurationMinutes: planMinimumDuration,
      typicalDurationMinutes: planTypicalDuration,
      maximumDurationMinutes: planMaximumDuration,
      publicNote: planPublicNote.trim(),
    });
    setEditorOpen(false);
    resetPlanEditor();
  }

  const canSaveRule =
    ruleScopeId.length > 0 &&
    ruleInterval >= 1 &&
    ruleMinimumDuration >= 1 &&
    ruleMinimumDuration <= ruleTypicalDuration &&
    ruleTypicalDuration <= ruleMaximumDuration;

  async function saveRecurringRule() {
    await onUpsertRecurringRule({
      ruleId: ruleEditorId ?? crypto.randomUUID(),
      ruleExpectedVersion,
      rule: {
        scopeType: ruleScopeType,
        scopeId: ruleScopeId,
        kind: ruleKind,
        triggerMetric: ruleTrigger,
        intervalValue: ruleInterval,
        minimumDurationMinutes: ruleMinimumDuration,
        typicalDurationMinutes: ruleTypicalDuration,
        maximumDurationMinutes: ruleMaximumDuration,
      },
      reason: "Wiederkehrende Tagesregel im Betriebsplan gepflegt.",
    });
    setRuleEditorOpen(false);
    resetRuleEditor();
  }

  const columns = [
    {
      key: "time",
      header: "Zeitraum",
      priority: "primary" as const,
      render: (plan: PlannedOperation) => (
        <div className="operational-plan-primary">
          <CalendarClock aria-hidden="true" />
          <span>
            {plan.startMode === "TIME_WINDOW"
              ? `${localPlanTime(plan.earliestStartAt, eventTimeZone)}–${localPlanTime(
                  plan.latestStartAt,
                  eventTimeZone,
                )}`
              : "Nach aktuellem Umlauf"}
          </span>
        </div>
      ),
    },
    {
      key: "scope",
      header: "Bereich",
      priority: "secondary" as const,
      render: (plan: PlannedOperation) => planScopeLabel(plan),
    },
    {
      key: "kind",
      header: "Wirkung",
      priority: "primary" as const,
      render: (plan: PlannedOperation) => (
        <span>
          {planKindLabels[plan.kind]} ·{" "}
          {plan.effectMode === "SLOWDOWN" ? `${plan.durationMultiplierPercent ?? 150} %` : "Stopp"}
        </span>
      ),
    },
    {
      key: "duration",
      header: "Dauer",
      priority: "tertiary" as const,
      render: (plan: PlannedOperation) =>
        `${plan.minimumDurationMinutes}/${plan.typicalDurationMinutes}/${plan.maximumDurationMinutes} Min.`,
    },
    {
      key: "status",
      header: "Status",
      priority: "primary" as const,
      render: (plan: PlannedOperation) => (
        <div className="operational-plan-status">
          <StatusPill tone={planStatusTone(plan.status)}>
            {planStatusLabels[plan.status]}
          </StatusPill>
          {mode === "admin" ? <small>Bestätigung durch Flight Director</small> : null}
        </div>
      ),
    },
  ];

  return (
    <section className={`operational-plan operational-plan--${mode}`}>
      {showPlans ? (
        <div className="operational-plan-section">
          <header className="operational-plan-header">
            <div>
              <div className="operational-plan-title">
                <h3>Betriebsplan</h3>
                <span>{currentPlans.length}</span>
              </div>
              <p>
                Zeitfenster sind bewusst ungefähr. Fällig bedeutet nur „prüfen“; Start und Ende
                werden immer bestätigt.
              </p>
            </div>
            {!readOnly ? (
              <Button disabled={busy} onClick={openNewPlan} type="button" variant="primary">
                <Plus aria-hidden="true" /> Einschränkung hinzufügen
              </Button>
            ) : null}
          </header>

          <DataTable
            className="operational-plan-table"
            columns={columns}
            emptyLabel={
              <div className="operational-plan-empty">
                <CalendarClock aria-hidden="true" />
                <strong>Noch keine Einschränkung geplant</strong>
                <p>
                  Pausen, Flugshows oder andere Verzögerungen können als weicher Plan erfasst
                  werden.
                </p>
                {!readOnly ? (
                  <Button onClick={openNewPlan} type="button" variant="secondary">
                    <Plus aria-hidden="true" /> Erste Einschränkung hinzufügen
                  </Button>
                ) : null}
              </div>
            }
            renderRowActions={(plan) => (
              <>
                {plan.status === "PLANNED" || plan.status === "DUE" ? (
                  <>
                    {!plan.recurringRuleId ? (
                      <IconButton
                        disabled={busy || readOnly}
                        label={`${planKindLabels[plan.kind]} bearbeiten`}
                        onClick={() => editPlannedOperation(plan)}
                        size="touch"
                        type="button"
                      >
                        <Pencil aria-hidden="true" />
                      </IconButton>
                    ) : null}
                    <IconButton
                      disabled={busy || readOnly}
                      label={
                        plan.recurringRuleId
                          ? `${planKindLabels[plan.kind]} dieses Mal überspringen`
                          : `${planKindLabels[plan.kind]} absagen`
                      }
                      onClick={() => setPendingCancel(plan)}
                      size="touch"
                      type="button"
                    >
                      <Ban aria-hidden="true" />
                    </IconButton>
                    {mode === "flight-director" && onConfirm ? (
                      <Button
                        disabled={busy}
                        onClick={() => onConfirm(plan, true)}
                        size="compact"
                        type="button"
                        variant="primary"
                      >
                        Start bestätigen
                      </Button>
                    ) : null}
                  </>
                ) : mode === "flight-director" && onConfirm ? (
                  <Button
                    disabled={busy}
                    onClick={() => onConfirm(plan, false)}
                    size="compact"
                    type="button"
                    variant="primary"
                  >
                    Ende bestätigen
                  </Button>
                ) : null}
              </>
            )}
            rowKey={(plan) => plan.id}
            rows={currentPlans}
          />
        </div>
      ) : null}

      {showRules ? (
        <section className="operational-rule-section">
          <header>
            <div>
              <h4>Wiederkehrende Regeln</h4>
              <p>
                Zum Beispiel: Tanken nach jeweils 5 bestätigten Umläufen. Bei Fälligkeit entsteht
                automatisch ein weicher Planeintrag; Start und Ende bleiben menschlich bestätigt.
              </p>
            </div>
            {!readOnly ? (
              <Button disabled={busy} onClick={openNewRule} size="compact" type="button">
                <Plus aria-hidden="true" /> Wiederkehrende Regel hinzufügen
              </Button>
            ) : null}
          </header>
          <div className="operational-rule-list">
            {recurringOperationalRules.filter((rule) => rule.status === "ACTIVE").length === 0 ? (
              <p className="operational-rule-empty">
                Keine aktive Wiederholung für diesen Flugtag.
              </p>
            ) : null}
            {recurringOperationalRules
              .filter((rule) => rule.status === "ACTIVE")
              .map((rule) => {
                const target =
                  rule.scopeType === "AIRCRAFT"
                    ? aircraft.find((entry) => entry.id === rule.scopeId)?.registration
                    : pilots.find((entry) => entry.id === rule.scopeId)?.operationalCode;
                const remaining = Math.max(0, rule.intervalValue - rule.progressValue);
                return (
                  <article key={rule.id}>
                    <div className="operational-rule-main">
                      <strong>
                        {planKindLabels[rule.kind]} · {target ?? rule.scopeId}
                      </strong>
                      <span>
                        nach {rule.intervalValue}{" "}
                        {rule.triggerMetric === "COMPLETED_ROTATIONS"
                          ? "Umläufen"
                          : "Betriebsminuten"}
                      </span>
                    </div>
                    <div>
                      <span>Fortschritt</span>
                      <strong>
                        {rule.progressValue} / {rule.intervalValue}
                      </strong>
                    </div>
                    <div>
                      <span>Dauerband</span>
                      <strong>
                        {rule.minimumDurationMinutes}/{rule.typicalDurationMinutes}/
                        {rule.maximumDurationMinutes} Min.
                      </strong>
                    </div>
                    <div>
                      <span>Nächste Fälligkeit</span>
                      <strong>
                        {rule.openPlannedOperationId
                          ? "Planeintrag offen"
                          : remaining === 0
                            ? "jetzt"
                            : `in ${remaining} ${
                                rule.triggerMetric === "COMPLETED_ROTATIONS" ? "Umläufen" : "Min."
                              }`}
                      </strong>
                    </div>
                    <div className="operational-rule-actions">
                      <IconButton
                        disabled={busy || readOnly}
                        label="Regel bearbeiten"
                        onClick={() => editRecurringRule(rule)}
                        size="touch"
                        type="button"
                      >
                        <Pencil aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        disabled={busy || readOnly}
                        label="Regel deaktivieren"
                        onClick={() => setPendingRuleDisable(rule)}
                        size="touch"
                        type="button"
                      >
                        <Ban aria-hidden="true" />
                      </IconButton>
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
      ) : null}

      <ModalDialog
        className="operational-plan-dialog"
        description="Interne Planung ohne automatische Zustandsänderung."
        footer={
          <>
            <Button
              disabled={busy}
              onClick={() => setEditorOpen(false)}
              type="button"
              variant="secondary"
            >
              Abbrechen
            </Button>
            <Button
              busy={busy}
              disabled={busy || !canSavePlan}
              onClick={savePlannedOperation}
              type="button"
              variant="primary"
            >
              {planEditorId ? "Änderungen speichern" : "Einplanen"}
            </Button>
          </>
        }
        onClose={() => setEditorOpen(false)}
        open={editorOpen}
        portal
        size="wide"
        title={planEditorId ? "Planeintrag bearbeiten" : "Einschränkung einplanen"}
      >
        <div className="operational-plan-form-grid">
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
            onChange={(event) => setPlanKind(event.target.value as PlannedOperation["kind"])}
            value={planKind}
          >
            {Object.entries(planKindLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Auswirkung"
            onChange={(event) =>
              setPlanEffectMode(event.target.value as PlannedOperation["effectMode"])
            }
            value={planEffectMode}
          >
            <option value="BLOCKING">Vollständige Einschränkung</option>
            <option value="SLOWDOWN">Verzögerter Betrieb</option>
          </SelectField>
          {planEffectMode === "SLOWDOWN" ? (
            <TextField
              help="150 % verlängert den noch offenen Umlauf auf das 1,5-Fache."
              label="Verzögerungsfaktor (%)"
              max="300"
              min="110"
              onChange={(event) => setPlanDurationMultiplierPercent(Number(event.target.value))}
              step="10"
              type="number"
              value={planDurationMultiplierPercent}
            />
          ) : null}
          <SelectField
            help="Intervalle wie „alle 5 Umläufe tanken“ werden als wiederkehrende Regel geplant."
            label="Beginn"
            onChange={(event) =>
              setPlanStartMode(event.target.value as PlannedOperation["startMode"])
            }
            value={planStartMode}
          >
            <option value="TIME_WINDOW">Ungefähres Zeitfenster</option>
            <option value="AFTER_CURRENT_ROTATION">Nach aktuellem Umlauf</option>
          </SelectField>
          {planStartMode === "TIME_WINDOW" ? (
            <>
              <LocalizedDateTimeInput
                label="Frühester Beginn"
                onChange={setPlanEarliestStart}
                value={planEarliestStart}
              />
              <LocalizedDateTimeInput
                label="Spätester Beginn"
                onChange={setPlanLatestStart}
                value={planLatestStart}
              />
            </>
          ) : (
            <SelectField
              disabled={eligiblePlanRotations.length === 0}
              help={
                eligiblePlanRotations.length === 0
                  ? "Kein aktueller Umlauf verfügbar. Für einen späteren Zeitpunkt bitte ein ungefähres Zeitfenster verwenden."
                  : "Die Einschränkung wird fällig, sobald der ausgewählte aktuelle Umlauf abgeschlossen oder abgebrochen ist."
              }
              label="Aktueller Bezugsumlauf"
              onChange={(event) => setPlanAfterRotationId(event.target.value)}
              value={planAfterRotationId}
            >
              <option value="">
                {eligiblePlanRotations.length === 0
                  ? "Kein aktueller Umlauf verfügbar"
                  : "Aktuellen Umlauf wählen"}
              </option>
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
        <TextField
          disabled={!["EVENT", "RESOURCE_GROUP"].includes(planScopeType)}
          help="Optional und neutral formuliert; keine interne Ursache veröffentlichen."
          label="Öffentlicher Hinweis"
          maxLength={160}
          onChange={(event) => setPlanPublicNote(event.target.value)}
          value={planPublicNote}
        />
      </ModalDialog>

      <ModalDialog
        className="operational-plan-dialog"
        description="Regeln gelten nur für diesen Flugtag und erzeugen weiche Planeinträge."
        footer={
          <>
            <Button onClick={() => setRuleEditorOpen(false)} type="button" variant="secondary">
              Abbrechen
            </Button>
            <Button
              busy={busy}
              disabled={busy || !canSaveRule}
              onClick={saveRecurringRule}
              type="button"
              variant="primary"
            >
              {ruleEditorId ? "Änderungen speichern" : "Regel anlegen"}
            </Button>
          </>
        }
        onClose={() => setRuleEditorOpen(false)}
        open={ruleEditorOpen}
        portal
        size="wide"
        title={ruleEditorId ? "Wiederkehrende Regel bearbeiten" : "Wiederkehrende Regel anlegen"}
      >
        <div className="operational-plan-form-grid">
          <SelectField
            label="Zielart"
            onChange={(event) => {
              const scopeType = event.target.value as RecurringOperationalRule["scopeType"];
              setRuleScopeType(scopeType);
              setRuleScopeId(
                scopeType === "AIRCRAFT" ? (aircraft[0]?.id ?? "") : (pilots[0]?.id ?? ""),
              );
              if (scopeType === "PILOT") setRuleKind("PAUSE");
            }}
            value={ruleScopeType}
          >
            <option value="AIRCRAFT">Flugzeug</option>
            <option value="PILOT">Pilotencode</option>
          </SelectField>
          <SelectField
            label="Ziel"
            onChange={(event) => setRuleScopeId(event.target.value)}
            value={ruleScopeId}
          >
            {ruleTargets.map((target) => (
              <option key={target.value} value={target.value}>
                {target.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Art"
            onChange={(event) =>
              setRuleKind(event.target.value as RecurringOperationalRule["kind"])
            }
            value={ruleKind}
          >
            <option value="PAUSE">Pause</option>
            {ruleScopeType === "AIRCRAFT" ? <option value="REFUELING">Tanken</option> : null}
          </SelectField>
          <SelectField
            label="Auslöser"
            onChange={(event) =>
              setRuleTrigger(event.target.value as RecurringOperationalRule["triggerMetric"])
            }
            value={ruleTrigger}
          >
            <option value="COMPLETED_ROTATIONS">Bestätigte Umläufe</option>
            <option value="OPERATING_MINUTES">Bestätigte Betriebsminuten</option>
          </SelectField>
          <TextField
            className="operational-rule-trigger-value"
            help={
              ruleKind === "REFUELING" && ruleTrigger === "COMPLETED_ROTATIONS"
                ? "Vorgeschlagen aus der Tank-Erinnerung; das Stammdatum bleibt unverändert."
                : undefined
            }
            label={
              ruleTrigger === "COMPLETED_ROTATIONS"
                ? "Umläufe bis zur Auslösung"
                : "Betriebsminuten bis zur Auslösung"
            }
            min="1"
            onChange={(event) => setRuleInterval(Number(event.target.value))}
            type="number"
            value={ruleInterval}
          />
          <TextField
            label="Dauer Minimum (Min.)"
            min="1"
            onChange={(event) => setRuleMinimumDuration(Number(event.target.value))}
            type="number"
            value={ruleMinimumDuration}
          />
          <TextField
            label="Dauer typisch (Min.)"
            min="1"
            onChange={(event) => setRuleTypicalDuration(Number(event.target.value))}
            type="number"
            value={ruleTypicalDuration}
          />
          <TextField
            label="Dauer Maximum (Min.)"
            min="1"
            onChange={(event) => setRuleMaximumDuration(Number(event.target.value))}
            type="number"
            value={ruleMaximumDuration}
          />
        </div>
      </ModalDialog>

      <ConfirmationDialog
        body={
          <>
            <strong>{pendingCancel ? planKindLabels[pendingCancel.kind] : "Planeintrag"}</strong>{" "}
            {pendingCancel?.recurringRuleId
              ? "wird für dieses Vorkommen übersprungen; die Regel beginnt danach neu zu zählen."
              : "wird aus dem aktuellen Betriebsplan entfernt. Ein bereits aktiver Zustand bleibt unverändert."}
          </>
        }
        confirmBusy={busy}
        confirmLabel={
          pendingCancel?.recurringRuleId ? "Dieses Vorkommen überspringen" : "Planeintrag absagen"
        }
        danger
        onCancel={() => setPendingCancel(null)}
        onConfirm={async () => {
          if (!pendingCancel) return;
          await onCancel(pendingCancel);
          setPendingCancel(null);
        }}
        open={pendingCancel !== null}
        title="Planeintrag wirklich absagen?"
      />
      <ConfirmationDialog
        body="Zukünftige Projektionen entfallen. Ein bereits fälliger Planeintrag bleibt separat bestehen."
        confirmBusy={busy}
        confirmLabel="Regel deaktivieren"
        danger
        onCancel={() => setPendingRuleDisable(null)}
        onConfirm={async () => {
          if (!pendingRuleDisable) return;
          await onDisableRecurringRule(pendingRuleDisable);
          setPendingRuleDisable(null);
        }}
        open={pendingRuleDisable !== null}
        title="Wiederkehrende Regel deaktivieren?"
      />
    </section>
  );
}
