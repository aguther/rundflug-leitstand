import type { OperationBoard } from "@rundflug/contracts";
import { useEffect, useRef, useState } from "react";
import { Button, ModalDialog, TextAreaField } from "../../design-system/components";
import {
  OperationalPlanPanel,
  type PlannedOperation,
  type RecurringOperationalRule,
  type UpsertPlannedOperationPayload,
  type UpsertRecurringOperationalRulePayload,
} from "../operations/OperationalPlanPanel";

export type FlightDirectorOperationsSection = "operations" | "plan" | "resources";
type ResourceGroup = OperationBoard["resourceGroups"][number];
type ResourceGroupStatus = "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";
type NoticeEditorTarget = { kind: "event" } | { kind: "resource"; resourceGroupId: string };

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
  aircraft: OperationBoard["aircraft"];
  pilots: OperationBoard["pilots"];
  plannedOperations: OperationBoard["plannedOperations"];
  recurringOperationalRules: OperationBoard["recurringOperationalRules"];
  rotations: OperationBoard["rotations"];
  resourceGroups: ResourceGroup[];
  section: FlightDirectorOperationsSection | null;
  onCancelPlannedOperation: (plan: PlannedOperation) => Promise<void>;
  onClose: () => void;
  onConfirmPlannedOperation: (plan: PlannedOperation, activate: boolean) => Promise<void>;
  onDisableRecurringRule: (rule: RecurringOperationalRule) => Promise<void>;
  onPublishEventNotice: (notice: string) => Promise<boolean>;
  onPublishResourceNotice: (resourceGroupId: string, notice: string) => Promise<boolean>;
  onSetEventInterruption: (interrupted: boolean) => Promise<void>;
  onSetResourceGroupStatus: (resourceGroupId: string, status: ResourceGroupStatus) => Promise<void>;
  onTriggerEmergency: () => Promise<void>;
  onUpsertPlannedOperation: (payload: UpsertPlannedOperationPayload) => Promise<void>;
  onUpsertRecurringRule: (payload: UpsertRecurringOperationalRulePayload) => Promise<void>;
}

interface OperationalNoticeEditorProps {
  busy: boolean;
  context: { name: string; shortCode: string } | undefined;
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
}: Readonly<OperationalNoticeEditorProps>) {
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

function dialogDescription(
  noticeTarget: NoticeEditorTarget | null,
  selectedResourceGroup: ResourceGroup | null,
  section: FlightDirectorOperationsSection,
): string {
  if (noticeTarget?.kind === "event") {
    return "Der Hinweis gilt veranstaltungsweit und hat Vorrang vor Hinweisen einzelner Ressourcengruppen.";
  }
  if (selectedResourceGroup) return "Der Hinweis gilt ausschließlich für diese Ressourcengruppe.";
  if (section === "plan") {
    return "Geplante Einschränkungen und wiederkehrende Regeln für den Veranstaltungstag pflegen.";
  }
  if (section === "resources") {
    return "Status und Hinweise der Ressourcengruppen organisatorisch steuern.";
  }
  return "Organisatorische Betriebslage steuern. Keine Aktion besitzt flugbetriebliche oder sicherheitsbezogene Freigabewirkung.";
}

function dialogTitle(
  noticeTarget: NoticeEditorTarget | null,
  selectedResourceGroup: ResourceGroup | null,
  section: FlightDirectorOperationsSection,
): string {
  if (noticeTarget?.kind === "event") return "Veranstaltungsweiter Hinweis";
  if (selectedResourceGroup) return `Hinweis für ${selectedResourceGroup.name}`;
  if (section === "plan") return "Betriebsplan";
  if (section === "resources") return "Ressourcengruppen";
  return "Betrieb steuern";
}

function OperationsOverview({
  busy,
  emergencyMode,
  eventInterrupted,
  onEditEventNotice,
  onSetEventInterruption,
  onTriggerEmergency,
  publishedEventNotice,
}: Readonly<{
  busy: boolean;
  emergencyMode: boolean;
  eventInterrupted: boolean;
  onEditEventNotice: () => void;
  onSetEventInterruption: (interrupted: boolean) => Promise<void>;
  onTriggerEmergency: () => Promise<void>;
  publishedEventNotice: string;
}>) {
  const noticeStatus = publishedEventNotice
    ? "Hinweis veröffentlicht"
    : "Kein Hinweis veröffentlicht";
  const noticeAction = publishedEventNotice ? "Hinweis bearbeiten" : "Hinweis veröffentlichen";
  const operationStatus = eventInterrupted ? "unterbrochen" : "laufend";
  const interruptionAction = eventInterrupted ? "Betrieb fortsetzen" : "Betrieb unterbrechen";
  const interruptionVariant = eventInterrupted ? "primary" : "danger";
  return (
    <div className="flight-director-operation-panel">
      <section className="flight-director-event-notice-summary">
        <div>
          <h3>Veranstaltungsweiter Hinweis</h3>
          <p>{noticeStatus}</p>
        </div>
        <Button
          className="flight-director-notice-action"
          disabled={busy}
          onClick={onEditEventNotice}
          size="compact"
          type="button"
          variant="secondary"
        >
          {noticeAction}
        </Button>
      </section>
      <section className="flight-director-interruption">
        <div>
          <h3>Veranstaltungsbetrieb</h3>
          <p>
            Aktuell: <strong>{operationStatus}</strong>
          </p>
        </div>
        <Button
          disabled={busy}
          onClick={() => onSetEventInterruption(!eventInterrupted)}
          type="button"
          variant={interruptionVariant}
        >
          {interruptionAction}
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
        {!emergencyMode && (
          <Button disabled={busy} onClick={onTriggerEmergency} type="button" variant="danger">
            Not-Halt auslösen
          </Button>
        )}
      </section>
    </div>
  );
}

function ResourceGroupsOverview({
  busy,
  onEditResourceNotice,
  onSetResourceGroupStatus,
  resourceGroups,
}: Readonly<{
  busy: boolean;
  onEditResourceNotice: (group: ResourceGroup) => void;
  onSetResourceGroupStatus: (resourceGroupId: string, status: ResourceGroupStatus) => Promise<void>;
  resourceGroups: ResourceGroup[];
}>) {
  return (
    <div className="flight-director-operation-list">
      {resourceGroups.map((group) => {
        const noticeAction = group.operationalNote
          ? "Hinweis bearbeiten"
          : "Hinweis veröffentlichen";
        return (
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
                onClick={() => onEditResourceNotice(group)}
                size="compact"
                type="button"
                variant="secondary"
              >
                {noticeAction}
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
        );
      })}
    </div>
  );
}

interface OperationsSectionContentProps {
  aircraft: OperationBoard["aircraft"];
  busy: boolean;
  emergencyMode: boolean;
  eventId: string;
  eventInterrupted: boolean;
  eventTimeZone: string;
  onCancelPlannedOperation: (plan: PlannedOperation) => Promise<void>;
  onConfirmPlannedOperation: (plan: PlannedOperation, activate: boolean) => Promise<void>;
  onDisableRecurringRule: (rule: RecurringOperationalRule) => Promise<void>;
  onEditEventNotice: () => void;
  onEditResourceNotice: (group: ResourceGroup) => void;
  onSetEventInterruption: (interrupted: boolean) => Promise<void>;
  onSetResourceGroupStatus: (resourceGroupId: string, status: ResourceGroupStatus) => Promise<void>;
  onTriggerEmergency: () => Promise<void>;
  onUpsertPlannedOperation: (payload: UpsertPlannedOperationPayload) => Promise<void>;
  onUpsertRecurringRule: (payload: UpsertRecurringOperationalRulePayload) => Promise<void>;
  pilots: OperationBoard["pilots"];
  plannedOperations: OperationBoard["plannedOperations"];
  publishedEventNotice: string;
  recurringOperationalRules: OperationBoard["recurringOperationalRules"];
  resourceGroups: ResourceGroup[];
  rotations: OperationBoard["rotations"];
  section: FlightDirectorOperationsSection;
}

function OperationsSectionContent(props: Readonly<OperationsSectionContentProps>) {
  if (props.section === "operations") {
    return (
      <OperationsOverview
        busy={props.busy}
        emergencyMode={props.emergencyMode}
        eventInterrupted={props.eventInterrupted}
        onEditEventNotice={props.onEditEventNotice}
        onSetEventInterruption={props.onSetEventInterruption}
        onTriggerEmergency={props.onTriggerEmergency}
        publishedEventNotice={props.publishedEventNotice}
      />
    );
  }
  if (props.section === "resources") {
    return (
      <ResourceGroupsOverview
        busy={props.busy}
        onEditResourceNotice={props.onEditResourceNotice}
        onSetResourceGroupStatus={props.onSetResourceGroupStatus}
        resourceGroups={props.resourceGroups}
      />
    );
  }
  return (
    <div>
      <OperationalPlanPanel
        aircraft={props.aircraft}
        busy={props.busy}
        eventId={props.eventId}
        eventTimeZone={props.eventTimeZone}
        mode="flight-director"
        onCancel={props.onCancelPlannedOperation}
        onConfirm={props.onConfirmPlannedOperation}
        onDisableRecurringRule={props.onDisableRecurringRule}
        onUpsert={props.onUpsertPlannedOperation}
        onUpsertRecurringRule={props.onUpsertRecurringRule}
        pilots={props.pilots}
        plannedOperations={props.plannedOperations}
        recurringOperationalRules={props.recurringOperationalRules}
        resourceGroups={props.resourceGroups}
        rotations={props.rotations}
      />
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
  pilots,
  plannedOperations,
  recurringOperationalRules,
  resourceGroups,
  rotations,
  section,
  onCancelPlannedOperation,
  onClose,
  onConfirmPlannedOperation,
  onDisableRecurringRule,
  onPublishEventNotice,
  onPublishResourceNotice,
  onSetEventInterruption,
  onSetResourceGroupStatus,
  onTriggerEmergency,
  onUpsertPlannedOperation,
  onUpsertRecurringRule,
}: Readonly<FlightDirectorOperationsDialogProps>) {
  const open = section !== null;
  const activeSection = section ?? "operations";
  const [noticeTarget, setNoticeTarget] = useState<NoticeEditorTarget | null>(null);
  const [noticeDraft, setNoticeDraft] = useState("");
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
  useEffect(() => {
    if (open && !openedRef.current) {
      setNoticeTarget(null);
      setNoticeDraft("");
    }
    openedRef.current = open;
  }, [open]);

  function editEventNotice() {
    setNoticeTarget({ kind: "event" });
    setNoticeDraft(eventNotice);
  }

  function editResourceNotice(group: ResourceGroup) {
    setNoticeTarget({ kind: "resource", resourceGroupId: group.id });
    setNoticeDraft(group.operationalNote ?? "");
  }

  function returnFromNoticeEditor() {
    setNoticeTarget(null);
    setNoticeDraft("");
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

  const noticeContext = selectedResourceGroup
    ? { name: selectedResourceGroup.name, shortCode: selectedResourceGroup.shortCode }
    : undefined;
  const noticeHelp =
    noticeTarget?.kind === "event"
      ? "Maximal 240 Zeichen. Der Hinweis wird veranstaltungsweit veröffentlicht."
      : "Maximal 240 Zeichen. Der Hinweis wird in den operativen Ansichten dieser Ressourcengruppe angezeigt.";
  let dialogContent = (
    <div className="flight-director-operations-dialog">
      <OperationsSectionContent
        aircraft={aircraft}
        busy={busy}
        emergencyMode={emergencyMode}
        eventId={eventId}
        eventInterrupted={eventInterrupted}
        eventTimeZone={eventTimeZone}
        onCancelPlannedOperation={onCancelPlannedOperation}
        onConfirmPlannedOperation={onConfirmPlannedOperation}
        onDisableRecurringRule={onDisableRecurringRule}
        onEditEventNotice={editEventNotice}
        onEditResourceNotice={editResourceNotice}
        onSetEventInterruption={onSetEventInterruption}
        onSetResourceGroupStatus={onSetResourceGroupStatus}
        onTriggerEmergency={onTriggerEmergency}
        onUpsertPlannedOperation={onUpsertPlannedOperation}
        onUpsertRecurringRule={onUpsertRecurringRule}
        pilots={pilots}
        plannedOperations={plannedOperations}
        publishedEventNotice={publishedEventNotice}
        recurringOperationalRules={recurringOperationalRules}
        resourceGroups={resourceGroups}
        rotations={rotations}
        section={activeSection}
      />
    </div>
  );
  if (noticeEditorOpen) {
    dialogContent = (
      <OperationalNoticeEditor
        busy={busy}
        context={noticeContext}
        draft={noticeDraft}
        help={noticeHelp}
        onChange={setNoticeDraft}
        onDelete={deleteNotice}
        onSave={saveNotice}
        published={publishedNotice.length > 0}
      />
    );
  }

  return (
    <ModalDialog
      description={dialogDescription(noticeTarget, selectedResourceGroup, activeSection)}
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
      title={dialogTitle(noticeTarget, selectedResourceGroup, activeSection)}
    >
      {dialogContent}
    </ModalDialog>
  );
}
