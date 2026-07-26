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
  TextAreaField,
  TextField,
} from "../../design-system/components";
import { eventLocalDateTimeToIso, formatEventLocalDateTime } from "../../event-time";
import "./operational-plan.css";

export type PlannedOperation = OperationBoard["plannedOperations"][number];
export type UpsertPlannedOperationPayload = Extract<
  CommandEnvelope,
  { type: "UPSERT_PLANNED_OPERATION" }
>["payload"];

type OperationalPlanMode = "admin" | "flight-director";

export interface OperationalPlanPanelProps {
  aircraft: OperationBoard["aircraft"];
  busy: boolean;
  eventId: string;
  eventTimeZone: string;
  mode: OperationalPlanMode;
  pilots: OperationBoard["pilots"];
  plannedOperations: OperationBoard["plannedOperations"];
  readOnly?: boolean;
  resourceGroups: OperationBoard["resourceGroups"];
  rotations: OperationBoard["rotations"];
  onCancel: (plan: PlannedOperation) => Promise<void>;
  onConfirm?: (plan: PlannedOperation, activate: boolean) => Promise<void>;
  onUpsert: (payload: UpsertPlannedOperationPayload) => Promise<void>;
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
  pilots,
  plannedOperations,
  readOnly = false,
  resourceGroups,
  rotations,
  onCancel,
  onConfirm,
  onUpsert,
}: OperationalPlanPanelProps) {
  const [editorOpen, setEditorOpen] = useState(false);
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
  const [pendingCancel, setPendingCancel] = useState<PlannedOperation | null>(null);

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
    setPlanStartMode(plan.startMode);
    setPlanEarliestStart(formatEventLocalDateTime(plan.earliestStartAt, eventTimeZone));
    setPlanLatestStart(formatEventLocalDateTime(plan.latestStartAt, eventTimeZone));
    setPlanAfterRotationId(plan.afterRotationId ?? "");
    setPlanMinimumDuration(plan.minimumDurationMinutes);
    setPlanTypicalDuration(plan.typicalDurationMinutes);
    setPlanMaximumDuration(plan.maximumDurationMinutes);
    setPlanReason(plan.reason);
    setPlanPublicNote(plan.publicNote);
    setEditorOpen(true);
  }

  const planTargets =
    planScopeType === "RESOURCE_GROUP"
      ? resourceGroups.map((group) => ({ value: group.id, label: group.name }))
      : planScopeType === "AIRCRAFT"
        ? aircraft.map((entry) => ({ value: entry.id, label: entry.registration }))
        : planScopeType === "PILOT"
          ? pilots.map((pilot) => ({ value: pilot.id, label: pilot.operationalCode }))
          : [{ value: eventId, label: "Gesamte Veranstaltung" }];

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
    planReason.trim().length >= 3 &&
    planMinimumDuration >= 1 &&
    planMinimumDuration <= planTypicalDuration &&
    planTypicalDuration <= planMaximumDuration &&
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
      startMode: planStartMode,
      earliestStartAt: earliestIso,
      latestStartAt: latestIso,
      afterRotationId: planStartMode === "AFTER_CURRENT_ROTATION" ? planAfterRotationId : null,
      minimumDurationMinutes: planMinimumDuration,
      typicalDurationMinutes: planTypicalDuration,
      maximumDurationMinutes: planMaximumDuration,
      reason: planReason.trim(),
      publicNote: planPublicNote.trim(),
    });
    setEditorOpen(false);
    resetPlanEditor();
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
      header: "Art",
      priority: "primary" as const,
      render: (plan: PlannedOperation) => planKindLabels[plan.kind],
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
      <header className="operational-plan-header">
        <div>
          <div className="operational-plan-title">
            <h3>Betriebsplan</h3>
            <span>{currentPlans.length}</span>
          </div>
          <p>
            Zeitfenster sind bewusst ungefähr. Fällig bedeutet nur „prüfen“; Start und Ende werden
            immer bestätigt.
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
              Pausen, Flugshows oder andere Verzögerungen können als weicher Plan erfasst werden.
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
                <IconButton
                  disabled={busy || readOnly}
                  label={`${planKindLabels[plan.kind]} bearbeiten`}
                  onClick={() => editPlannedOperation(plan)}
                  size="touch"
                  type="button"
                >
                  <Pencil aria-hidden="true" />
                </IconButton>
                <IconButton
                  disabled={busy || readOnly}
                  label={`${planKindLabels[plan.kind]} absagen`}
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
          help="Nur intern sichtbar; wird mit dem Planeintrag auditiert."
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
      </ModalDialog>

      <ConfirmationDialog
        body={
          <>
            <strong>{pendingCancel ? planKindLabels[pendingCancel.kind] : "Planeintrag"}</strong>{" "}
            wird aus dem aktuellen Betriebsplan entfernt. Ein bereits aktiver Zustand bleibt
            unverändert.
          </>
        }
        confirmBusy={busy}
        confirmLabel="Planeintrag absagen"
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
    </section>
  );
}
