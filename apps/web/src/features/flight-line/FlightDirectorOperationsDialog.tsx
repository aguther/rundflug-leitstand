import type { OperationBoard } from "@rundflug/contracts";
import { useEffect, useRef, useState } from "react";
import { Button, ModalDialog, Tabs, TextAreaField } from "../../design-system/components";
import {
  OperationalPlanPanel,
  type PlannedOperation,
  type RecurringOperationalRule,
  type UpsertPlannedOperationPayload,
  type UpsertRecurringOperationalRulePayload,
} from "../operations/OperationalPlanPanel";

type OperationsTab = "operations" | "plan" | "resources";
type ResourceGroup = OperationBoard["resourceGroups"][number];
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
  recurringOperationalRules: OperationBoard["recurringOperationalRules"];
  rotations: OperationBoard["rotations"];
  resourceGroups: ResourceGroup[];
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
  recurringOperationalRules,
  resourceGroups,
  rotations,
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
}: FlightDirectorOperationsDialogProps) {
  const [tab, setTab] = useState<OperationsTab>("operations");
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
      setTab("operations");
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
            <div role="tabpanel">
              <OperationalPlanPanel
                aircraft={aircraft}
                busy={busy}
                eventId={eventId}
                eventTimeZone={eventTimeZone}
                mode="flight-director"
                onCancel={onCancelPlannedOperation}
                onConfirm={onConfirmPlannedOperation}
                onDisableRecurringRule={onDisableRecurringRule}
                onUpsert={onUpsertPlannedOperation}
                onUpsertRecurringRule={onUpsertRecurringRule}
                pilots={pilots}
                plannedOperations={plannedOperations}
                recurringOperationalRules={recurringOperationalRules}
                resourceGroups={resourceGroups}
                rotations={rotations}
              />
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
