import type { CommandEnvelope, OperationBoard } from "@rundflug/contracts";
import { Ban, CalendarClock, Pencil, Repeat2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  AddButton,
  Button,
  ConfirmationDialog,
  DataTable,
  type DataTableColumn,
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
type PlanScopeType = PlannedOperation["scopeType"];
type RuleScopeType = RecurringOperationalRule["scopeType"];
type TargetOption = { value: string; label: string };

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

function planTargetOptions(
  scopeType: PlanScopeType,
  eventId: string,
  resourceGroups: OperationBoard["resourceGroups"],
  aircraft: OperationBoard["aircraft"],
  pilots: OperationBoard["pilots"],
): TargetOption[] {
  if (scopeType === "RESOURCE_GROUP") {
    return resourceGroups.map((group) => ({ value: group.id, label: group.name }));
  }
  if (scopeType === "AIRCRAFT") {
    return aircraft.map((entry) => ({ value: entry.id, label: entry.registration }));
  }
  if (scopeType === "PILOT") {
    return pilots.map((pilot) => ({ value: pilot.id, label: pilot.operationalCode }));
  }
  return [{ value: eventId, label: "Gesamte Veranstaltung" }];
}

function firstPlanTargetId(
  scopeType: PlanScopeType,
  eventId: string,
  resourceGroups: OperationBoard["resourceGroups"],
  aircraft: OperationBoard["aircraft"],
  pilots: OperationBoard["pilots"],
): string {
  return planTargetOptions(scopeType, eventId, resourceGroups, aircraft, pilots)[0]?.value ?? "";
}

function ruleTargetOptions(
  scopeType: RuleScopeType,
  aircraft: OperationBoard["aircraft"],
  pilots: OperationBoard["pilots"],
): TargetOption[] {
  if (scopeType === "AIRCRAFT") {
    return aircraft.map((entry) => ({ value: entry.id, label: entry.registration }));
  }
  return pilots.map((entry) => ({ value: entry.id, label: entry.operationalCode }));
}

function recurringRuleDueLabel(rule: RecurringOperationalRule): string {
  if (rule.openPlannedOperationId) return "Planeintrag offen";
  const remaining = Math.max(0, rule.intervalValue - rule.progressValue);
  if (remaining === 0) return "jetzt";
  const unit = rule.triggerMetric === "COMPLETED_ROTATIONS" ? "Umläufen" : "Min.";
  return `in ${remaining} ${unit}`;
}

function eligibleRotationsForPlan(
  rotations: OperationBoard["rotations"],
  scopeType: PlanScopeType,
  scopeId: string,
  resourceGroups: OperationBoard["resourceGroups"],
) {
  const resourceGroup = resourceGroups.find((entry) => entry.id === scopeId);
  return rotations.filter((rotation) => {
    if (!["CALLED", "IN_FLIGHT", "LANDED"].includes(rotation.status)) return false;
    if (scopeType === "EVENT") return true;
    if (scopeType === "AIRCRAFT") return rotation.aircraftId === scopeId;
    if (scopeType === "PILOT") return rotation.pilotId === scopeId;
    return (
      rotation.aircraftId !== null &&
      Boolean(resourceGroup?.activeAircraftIds.includes(rotation.aircraftId))
    );
  });
}

function planScopeLabel(
  plan: PlannedOperation,
  resourceGroups: OperationBoard["resourceGroups"],
  aircraft: OperationBoard["aircraft"],
  pilots: OperationBoard["pilots"],
): string {
  if (plan.scopeType === "EVENT") return "Gesamte Veranstaltung";
  if (plan.scopeType === "RESOURCE_GROUP") {
    return resourceGroups.find((group) => group.id === plan.scopeId)?.name ?? plan.scopeId;
  }
  if (plan.scopeType === "AIRCRAFT") {
    return aircraft.find((entry) => entry.id === plan.scopeId)?.registration ?? plan.scopeId;
  }
  return pilots.find((pilot) => pilot.id === plan.scopeId)?.operationalCode ?? plan.scopeId;
}

function createPlanColumns(
  eventTimeZone: string,
  mode: OperationalPlanMode,
  resourceGroups: OperationBoard["resourceGroups"],
  aircraft: OperationBoard["aircraft"],
  pilots: OperationBoard["pilots"],
): DataTableColumn<PlannedOperation>[] {
  return [
    {
      key: "time",
      header: "Zeitraum",
      priority: "primary",
      render: (plan) => {
        const timeLabel =
          plan.startMode === "TIME_WINDOW"
            ? `${localPlanTime(plan.earliestStartAt, eventTimeZone)}–${localPlanTime(plan.latestStartAt, eventTimeZone)}`
            : "Nach aktuellem Umlauf";
        return (
          <div className="operational-plan-primary">
            <CalendarClock aria-hidden="true" />
            <span>{timeLabel}</span>
          </div>
        );
      },
    },
    {
      key: "scope",
      header: "Bereich",
      priority: "secondary",
      render: (plan) => planScopeLabel(plan, resourceGroups, aircraft, pilots),
    },
    {
      key: "kind",
      header: "Wirkung",
      priority: "primary",
      render: (plan) => {
        const effectLabel =
          plan.effectMode === "SLOWDOWN" ? `${plan.durationMultiplierPercent ?? 150} %` : "Stopp";
        return (
          <span>
            {planKindLabels[plan.kind]} · {effectLabel}
          </span>
        );
      },
    },
    {
      key: "duration",
      header: "Dauer",
      priority: "tertiary",
      render: (plan) =>
        `${plan.minimumDurationMinutes}/${plan.typicalDurationMinutes}/${plan.maximumDurationMinutes} Min.`,
    },
    {
      key: "status",
      header: "Status",
      priority: "primary",
      render: (plan) => (
        <div className="operational-plan-status">
          <StatusPill tone={planStatusTone(plan.status)}>
            {planStatusLabels[plan.status]}
          </StatusPill>
          {mode === "admin" && <small>Bestätigung durch Flight Director</small>}
        </div>
      ),
    },
  ];
}

function createRecurringRuleColumns(
  aircraft: OperationBoard["aircraft"],
  pilots: OperationBoard["pilots"],
): DataTableColumn<RecurringOperationalRule>[] {
  return [
    {
      key: "rule",
      header: "Regel",
      priority: "primary",
      render: (rule) => {
        const target =
          rule.scopeType === "AIRCRAFT"
            ? aircraft.find((entry) => entry.id === rule.scopeId)?.registration
            : pilots.find((entry) => entry.id === rule.scopeId)?.operationalCode;
        const triggerUnit =
          rule.triggerMetric === "COMPLETED_ROTATIONS" ? "Umläufen" : "Betriebsminuten";
        return (
          <div className="operational-rule-primary">
            <strong>
              {planKindLabels[rule.kind]} · {target ?? rule.scopeId}
            </strong>
            <span>
              nach {rule.intervalValue} {triggerUnit}
            </span>
          </div>
        );
      },
    },
    {
      key: "progress",
      header: "Fortschritt",
      priority: "primary",
      render: (rule) => (
        <strong>
          {rule.progressValue} / {rule.intervalValue}
        </strong>
      ),
    },
    {
      key: "duration",
      header: "Dauerband",
      priority: "tertiary",
      render: (rule) => (
        <strong>
          {rule.minimumDurationMinutes}/{rule.typicalDurationMinutes}/{rule.maximumDurationMinutes}{" "}
          Min.
        </strong>
      ),
    },
    {
      key: "nextDue",
      header: "Nächste Fälligkeit",
      priority: "secondary",
      render: (rule) => <strong>{recurringRuleDueLabel(rule)}</strong>,
    },
  ];
}

function PlanRowActions({
  busy,
  mode,
  onCancel,
  onConfirm,
  onEdit,
  plan,
  readOnly,
}: Readonly<{
  busy: boolean;
  mode: OperationalPlanMode;
  onCancel: (plan: PlannedOperation) => void;
  onConfirm: ((plan: PlannedOperation, activate: boolean) => Promise<void>) | undefined;
  onEdit: (plan: PlannedOperation) => void;
  plan: PlannedOperation;
  readOnly: boolean;
}>) {
  const confirmAvailable = mode === "flight-director" && onConfirm !== undefined;
  if (plan.status === "ACTIVE") {
    if (!confirmAvailable) return null;
    return (
      <Button
        disabled={busy}
        onClick={() => onConfirm?.(plan, false)}
        size="compact"
        type="button"
        variant="primary"
      >
        Ende bestätigen
      </Button>
    );
  }
  if (plan.status !== "PLANNED" && plan.status !== "DUE") return null;
  const cancelLabel = plan.recurringRuleId
    ? `${planKindLabels[plan.kind]} dieses Mal überspringen`
    : `${planKindLabels[plan.kind]} absagen`;
  return (
    <>
      {!plan.recurringRuleId && (
        <IconButton
          disabled={busy || readOnly}
          label={`${planKindLabels[plan.kind]} bearbeiten`}
          onClick={() => onEdit(plan)}
          size="touch"
          type="button"
        >
          <Pencil aria-hidden="true" />
        </IconButton>
      )}
      <IconButton
        disabled={busy || readOnly}
        label={cancelLabel}
        onClick={() => onCancel(plan)}
        size="touch"
        type="button"
      >
        <Ban aria-hidden="true" />
      </IconButton>
      {confirmAvailable && (
        <Button
          disabled={busy}
          onClick={() => onConfirm?.(plan, true)}
          size="compact"
          type="button"
          variant="primary"
        >
          Start bestätigen
        </Button>
      )}
    </>
  );
}

interface PlanEditorDialogProps {
  afterRotationId: string;
  busy: boolean;
  canSave: boolean;
  durationMultiplierPercent: number;
  earliestStart: string;
  editorId: string | null;
  effectMode: PlannedOperation["effectMode"];
  eligibleRotations: OperationBoard["rotations"];
  kind: PlannedOperation["kind"];
  latestStart: string;
  maximumDuration: number;
  minimumDuration: number;
  onAfterRotationIdChange: (value: string) => void;
  onClose: () => void;
  onDurationMultiplierPercentChange: (value: number) => void;
  onEarliestStartChange: (value: string) => void;
  onEffectModeChange: (value: PlannedOperation["effectMode"]) => void;
  onKindChange: (value: PlannedOperation["kind"]) => void;
  onLatestStartChange: (value: string) => void;
  onMaximumDurationChange: (value: number) => void;
  onMinimumDurationChange: (value: number) => void;
  onPublicNoteChange: (value: string) => void;
  onSave: () => Promise<void>;
  onScopeIdChange: (value: string) => void;
  onScopeTypeChange: (value: PlanScopeType) => void;
  onStartModeChange: (value: PlannedOperation["startMode"]) => void;
  onTypicalDurationChange: (value: number) => void;
  open: boolean;
  publicNote: string;
  scopeId: string;
  scopeType: PlanScopeType;
  startMode: PlannedOperation["startMode"];
  targets: TargetOption[];
  typicalDuration: number;
}

function PlanEditorDialog(props: Readonly<PlanEditorDialogProps>) {
  const hasEligibleRotation = props.eligibleRotations.length > 0;
  const rotationHelp = hasEligibleRotation
    ? "Die Einschränkung wird fällig, sobald der ausgewählte aktuelle Umlauf abgeschlossen oder abgebrochen ist."
    : "Kein aktueller Umlauf verfügbar. Für einen späteren Zeitpunkt bitte ein ungefähres Zeitfenster verwenden.";
  const rotationPlaceholder = hasEligibleRotation
    ? "Aktuellen Umlauf wählen"
    : "Kein aktueller Umlauf verfügbar";
  return (
    <ModalDialog
      className="operational-plan-dialog"
      description="Interne Planung ohne automatische Zustandsänderung."
      footer={
        <>
          <Button disabled={props.busy} onClick={props.onClose} type="button" variant="secondary">
            Abbrechen
          </Button>
          <Button
            busy={props.busy}
            disabled={props.busy || !props.canSave}
            onClick={props.onSave}
            type="button"
            variant="primary"
          >
            {props.editorId ? "Änderungen speichern" : "Einplanen"}
          </Button>
        </>
      }
      onClose={props.onClose}
      open={props.open}
      portal
      size="wide"
      title={props.editorId ? "Planeintrag bearbeiten" : "Einschränkung einplanen"}
    >
      <div className="operational-plan-form-grid">
        <SelectField
          label="Geltungsbereich"
          onChange={(event) => props.onScopeTypeChange(event.target.value as PlanScopeType)}
          value={props.scopeType}
        >
          <option value="EVENT">Veranstaltung</option>
          <option value="RESOURCE_GROUP">Ressourcengruppe</option>
          <option value="AIRCRAFT">Flugzeug</option>
          <option value="PILOT">Pilotencode</option>
        </SelectField>
        <SelectField
          disabled={props.scopeType === "EVENT"}
          label="Ziel"
          onChange={(event) => props.onScopeIdChange(event.target.value)}
          value={props.scopeId}
        >
          {props.targets.map((target) => (
            <option key={target.value} value={target.value}>
              {target.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Art"
          onChange={(event) => props.onKindChange(event.target.value as PlannedOperation["kind"])}
          value={props.kind}
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
            props.onEffectModeChange(event.target.value as PlannedOperation["effectMode"])
          }
          value={props.effectMode}
        >
          <option value="BLOCKING">Vollständige Einschränkung</option>
          <option value="SLOWDOWN">Verzögerter Betrieb</option>
        </SelectField>
        {props.effectMode === "SLOWDOWN" && (
          <TextField
            help="150 % verlängert den noch offenen Umlauf auf das 1,5-Fache."
            label="Verzögerungsfaktor (%)"
            max="300"
            min="110"
            onChange={(event) =>
              props.onDurationMultiplierPercentChange(Number(event.target.value))
            }
            step="10"
            type="number"
            value={props.durationMultiplierPercent}
          />
        )}
        <SelectField
          help="Intervalle wie „alle 5 Umläufe tanken“ werden als wiederkehrende Regel geplant."
          label="Beginn"
          onChange={(event) =>
            props.onStartModeChange(event.target.value as PlannedOperation["startMode"])
          }
          value={props.startMode}
        >
          <option value="TIME_WINDOW">Ungefähres Zeitfenster</option>
          <option value="AFTER_CURRENT_ROTATION">Nach aktuellem Umlauf</option>
        </SelectField>
        {props.startMode === "TIME_WINDOW" ? (
          <>
            <LocalizedDateTimeInput
              label="Frühester Beginn"
              onChange={props.onEarliestStartChange}
              value={props.earliestStart}
            />
            <LocalizedDateTimeInput
              label="Spätester Beginn"
              onChange={props.onLatestStartChange}
              value={props.latestStart}
            />
          </>
        ) : (
          <SelectField
            disabled={!hasEligibleRotation}
            help={rotationHelp}
            label="Aktueller Bezugsumlauf"
            onChange={(event) => props.onAfterRotationIdChange(event.target.value)}
            value={props.afterRotationId}
          >
            <option value="">{rotationPlaceholder}</option>
            {props.eligibleRotations.map((rotation) => (
              <option key={rotation.id} value={rotation.id}>
                {rotation.communicationLabel} · {rotation.status}
              </option>
            ))}
          </SelectField>
        )}
        <TextField
          label="Dauer Minimum (Min.)"
          min="1"
          onChange={(event) => props.onMinimumDurationChange(Number(event.target.value))}
          type="number"
          value={props.minimumDuration}
        />
        <TextField
          label="Dauer typisch (Min.)"
          min="1"
          onChange={(event) => props.onTypicalDurationChange(Number(event.target.value))}
          type="number"
          value={props.typicalDuration}
        />
        <TextField
          label="Dauer Maximum (Min.)"
          min="1"
          onChange={(event) => props.onMaximumDurationChange(Number(event.target.value))}
          type="number"
          value={props.maximumDuration}
        />
      </div>
      <TextField
        disabled={!["EVENT", "RESOURCE_GROUP"].includes(props.scopeType)}
        help="Optional und neutral formuliert; keine interne Ursache veröffentlichen."
        label="Öffentlicher Hinweis"
        maxLength={160}
        onChange={(event) => props.onPublicNoteChange(event.target.value)}
        value={props.publicNote}
      />
    </ModalDialog>
  );
}

interface RuleEditorDialogProps {
  busy: boolean;
  canSave: boolean;
  editorId: string | null;
  interval: number;
  kind: RecurringOperationalRule["kind"];
  maximumDuration: number;
  minimumDuration: number;
  onClose: () => void;
  onIntervalChange: (value: number) => void;
  onKindChange: (value: RecurringOperationalRule["kind"]) => void;
  onMaximumDurationChange: (value: number) => void;
  onMinimumDurationChange: (value: number) => void;
  onSave: () => Promise<void>;
  onScopeIdChange: (value: string) => void;
  onScopeTypeChange: (value: RuleScopeType) => void;
  onTriggerChange: (value: RecurringOperationalRule["triggerMetric"]) => void;
  onTypicalDurationChange: (value: number) => void;
  open: boolean;
  scopeId: string;
  scopeType: RuleScopeType;
  targets: TargetOption[];
  trigger: RecurringOperationalRule["triggerMetric"];
  typicalDuration: number;
}

function RuleEditorDialog(props: Readonly<RuleEditorDialogProps>) {
  const intervalHelp =
    props.kind === "REFUELING" && props.trigger === "COMPLETED_ROTATIONS"
      ? "Vorgeschlagen aus der Tank-Erinnerung; das Stammdatum bleibt unverändert."
      : undefined;
  const intervalLabel =
    props.trigger === "COMPLETED_ROTATIONS"
      ? "Umläufe bis zur Auslösung"
      : "Betriebsminuten bis zur Auslösung";
  return (
    <ModalDialog
      className="operational-plan-dialog"
      description="Regeln gelten nur für diesen Flugtag und erzeugen weiche Planeinträge."
      footer={
        <>
          <Button onClick={props.onClose} type="button" variant="secondary">
            Abbrechen
          </Button>
          <Button
            busy={props.busy}
            disabled={props.busy || !props.canSave}
            onClick={props.onSave}
            type="button"
            variant="primary"
          >
            {props.editorId ? "Änderungen speichern" : "Regel anlegen"}
          </Button>
        </>
      }
      onClose={props.onClose}
      open={props.open}
      portal
      size="wide"
      title={props.editorId ? "Wiederkehrende Regel bearbeiten" : "Wiederkehrende Regel anlegen"}
    >
      <div className="operational-plan-form-grid">
        <SelectField
          label="Zielart"
          onChange={(event) => props.onScopeTypeChange(event.target.value as RuleScopeType)}
          value={props.scopeType}
        >
          <option value="AIRCRAFT">Flugzeug</option>
          <option value="PILOT">Pilotencode</option>
        </SelectField>
        <SelectField
          label="Ziel"
          onChange={(event) => props.onScopeIdChange(event.target.value)}
          value={props.scopeId}
        >
          {props.targets.map((target) => (
            <option key={target.value} value={target.value}>
              {target.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Art"
          onChange={(event) =>
            props.onKindChange(event.target.value as RecurringOperationalRule["kind"])
          }
          value={props.kind}
        >
          <option value="PAUSE">Pause</option>
          {props.scopeType === "AIRCRAFT" && <option value="REFUELING">Tanken</option>}
        </SelectField>
        <SelectField
          label="Auslöser"
          onChange={(event) =>
            props.onTriggerChange(event.target.value as RecurringOperationalRule["triggerMetric"])
          }
          value={props.trigger}
        >
          <option value="COMPLETED_ROTATIONS">Bestätigte Umläufe</option>
          <option value="OPERATING_MINUTES">Bestätigte Betriebsminuten</option>
        </SelectField>
        <TextField
          className="operational-rule-trigger-value"
          help={intervalHelp}
          label={intervalLabel}
          min="1"
          onChange={(event) => props.onIntervalChange(Number(event.target.value))}
          type="number"
          value={props.interval}
        />
        <TextField
          label="Dauer Minimum (Min.)"
          min="1"
          onChange={(event) => props.onMinimumDurationChange(Number(event.target.value))}
          type="number"
          value={props.minimumDuration}
        />
        <TextField
          label="Dauer typisch (Min.)"
          min="1"
          onChange={(event) => props.onTypicalDurationChange(Number(event.target.value))}
          type="number"
          value={props.typicalDuration}
        />
        <TextField
          label="Dauer Maximum (Min.)"
          min="1"
          onChange={(event) => props.onMaximumDurationChange(Number(event.target.value))}
          type="number"
          value={props.maximumDuration}
        />
      </div>
    </ModalDialog>
  );
}

function PlanConfirmationDialogs({
  busy,
  onCancelPlan,
  onDisableRule,
  pendingCancel,
  pendingRuleDisable,
  setPendingCancel,
  setPendingRuleDisable,
}: Readonly<{
  busy: boolean;
  onCancelPlan: (plan: PlannedOperation) => Promise<void>;
  onDisableRule: (rule: RecurringOperationalRule) => Promise<void>;
  pendingCancel: PlannedOperation | null;
  pendingRuleDisable: RecurringOperationalRule | null;
  setPendingCancel: (plan: PlannedOperation | null) => void;
  setPendingRuleDisable: (rule: RecurringOperationalRule | null) => void;
}>) {
  const cancelSubject = pendingCancel ? planKindLabels[pendingCancel.kind] : "Planeintrag";
  const recurringOccurrence = Boolean(pendingCancel?.recurringRuleId);
  const cancelBody = recurringOccurrence
    ? "wird für dieses Vorkommen übersprungen; die Regel beginnt danach neu zu zählen."
    : "wird aus dem aktuellen Betriebsplan entfernt. Ein bereits aktiver Zustand bleibt unverändert.";
  const cancelLabel = recurringOccurrence ? "Dieses Vorkommen überspringen" : "Planeintrag absagen";
  return (
    <>
      <ConfirmationDialog
        body={
          <>
            <strong>{cancelSubject}</strong> {cancelBody}
          </>
        }
        confirmBusy={busy}
        confirmLabel={cancelLabel}
        danger
        onCancel={() => setPendingCancel(null)}
        onConfirm={async () => {
          if (!pendingCancel) return;
          await onCancelPlan(pendingCancel);
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
          await onDisableRule(pendingRuleDisable);
          setPendingRuleDisable(null);
        }}
        open={pendingRuleDisable !== null}
        title="Wiederkehrende Regel deaktivieren?"
      />
    </>
  );
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
}: Readonly<OperationalPlanPanelProps>) {
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
  const activeRecurringRules = recurringOperationalRules.filter((rule) => rule.status === "ACTIVE");

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

  const planTargets = planTargetOptions(planScopeType, eventId, resourceGroups, aircraft, pilots);
  const ruleTargets = ruleTargetOptions(ruleScopeType, aircraft, pilots);
  const eligiblePlanRotations = eligibleRotationsForPlan(
    rotations,
    planScopeType,
    planScopeId,
    resourceGroups,
  );

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

  const columns = createPlanColumns(eventTimeZone, mode, resourceGroups, aircraft, pilots);
  const recurringRuleColumns = createRecurringRuleColumns(aircraft, pilots);

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
              <AddButton
                ariaLabel="Einschränkung hinzufügen"
                disabled={busy}
                onClick={openNewPlan}
              />
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
              </div>
            }
            renderRowActions={(plan) => (
              <PlanRowActions
                busy={busy}
                mode={mode}
                onCancel={setPendingCancel}
                onConfirm={onConfirm}
                onEdit={editPlannedOperation}
                plan={plan}
                readOnly={readOnly}
              />
            )}
            rowKey={(plan) => plan.id}
            rows={currentPlans}
          />
        </div>
      ) : null}

      {showRules ? (
        <section className="operational-plan-section">
          <header className="operational-plan-header">
            <div>
              <div className="operational-plan-title">
                <h3>Wiederkehrende Regeln</h3>
                <span>{activeRecurringRules.length}</span>
              </div>
              <p>
                Zum Beispiel: Tanken nach jeweils 5 bestätigten Umläufen. Bei Fälligkeit entsteht
                automatisch ein weicher Planeintrag; Start und Ende bleiben menschlich bestätigt.
              </p>
            </div>
            {!readOnly ? (
              <AddButton ariaLabel="Regel hinzufügen" disabled={busy} onClick={openNewRule} />
            ) : null}
          </header>
          <DataTable
            className="operational-plan-table operational-rule-table"
            columns={recurringRuleColumns}
            emptyLabel={
              <div className="operational-plan-empty">
                <Repeat2 aria-hidden="true" />
                <strong>Noch keine wiederkehrende Regel angelegt</strong>
                <p>
                  Bei Fälligkeit entsteht ein weicher Planeintrag; Start und Ende bleiben menschlich
                  bestätigt.
                </p>
              </div>
            }
            renderRowActions={(rule) => (
              <>
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
              </>
            )}
            rowKey={(rule) => rule.id}
            rows={activeRecurringRules}
          />
        </section>
      ) : null}

      <PlanEditorDialog
        afterRotationId={planAfterRotationId}
        busy={busy}
        canSave={canSavePlan}
        durationMultiplierPercent={planDurationMultiplierPercent}
        earliestStart={planEarliestStart}
        editorId={planEditorId}
        effectMode={planEffectMode}
        eligibleRotations={eligiblePlanRotations}
        kind={planKind}
        latestStart={planLatestStart}
        maximumDuration={planMaximumDuration}
        minimumDuration={planMinimumDuration}
        onAfterRotationIdChange={setPlanAfterRotationId}
        onClose={() => setEditorOpen(false)}
        onDurationMultiplierPercentChange={setPlanDurationMultiplierPercent}
        onEarliestStartChange={setPlanEarliestStart}
        onEffectModeChange={setPlanEffectMode}
        onKindChange={setPlanKind}
        onLatestStartChange={setPlanLatestStart}
        onMaximumDurationChange={setPlanMaximumDuration}
        onMinimumDurationChange={setPlanMinimumDuration}
        onPublicNoteChange={setPlanPublicNote}
        onSave={savePlannedOperation}
        onScopeIdChange={(value) => {
          setPlanScopeId(value);
          setPlanAfterRotationId("");
        }}
        onScopeTypeChange={(value) => {
          setPlanScopeType(value);
          setPlanScopeId(firstPlanTargetId(value, eventId, resourceGroups, aircraft, pilots));
          setPlanAfterRotationId("");
          if (!["EVENT", "RESOURCE_GROUP"].includes(value)) setPlanPublicNote("");
        }}
        onStartModeChange={setPlanStartMode}
        onTypicalDurationChange={setPlanTypicalDuration}
        open={editorOpen}
        publicNote={planPublicNote}
        scopeId={planScopeId}
        scopeType={planScopeType}
        startMode={planStartMode}
        targets={planTargets}
        typicalDuration={planTypicalDuration}
      />
      <RuleEditorDialog
        busy={busy}
        canSave={canSaveRule}
        editorId={ruleEditorId}
        interval={ruleInterval}
        kind={ruleKind}
        maximumDuration={ruleMaximumDuration}
        minimumDuration={ruleMinimumDuration}
        onClose={() => setRuleEditorOpen(false)}
        onIntervalChange={setRuleInterval}
        onKindChange={setRuleKind}
        onMaximumDurationChange={setRuleMaximumDuration}
        onMinimumDurationChange={setRuleMinimumDuration}
        onSave={saveRecurringRule}
        onScopeIdChange={setRuleScopeId}
        onScopeTypeChange={(scopeType) => {
          setRuleScopeType(scopeType);
          setRuleScopeId(ruleTargetOptions(scopeType, aircraft, pilots)[0]?.value ?? "");
          if (scopeType === "PILOT") setRuleKind("PAUSE");
        }}
        onTriggerChange={setRuleTrigger}
        onTypicalDurationChange={setRuleTypicalDuration}
        open={ruleEditorOpen}
        scopeId={ruleScopeId}
        scopeType={ruleScopeType}
        targets={ruleTargets}
        trigger={ruleTrigger}
        typicalDuration={ruleTypicalDuration}
      />
      <PlanConfirmationDialogs
        busy={busy}
        onCancelPlan={onCancel}
        onDisableRule={onDisableRecurringRule}
        pendingCancel={pendingCancel}
        pendingRuleDisable={pendingRuleDisable}
        setPendingCancel={setPendingCancel}
        setPendingRuleDisable={setPendingRuleDisable}
      />
    </section>
  );
}
