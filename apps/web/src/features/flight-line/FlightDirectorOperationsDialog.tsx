import type { OperationBoard } from "@rundflug/contracts";
import { useEffect, useRef, useState } from "react";
import { Button, ModalDialog, Tabs, TextAreaField } from "../../design-system/components";

type OperationsTab = "operations" | "resources";
type ResourceGroup = OperationBoard["resourceGroups"][number];
type ResourceGroupStatus = "ACTIVE" | "PAUSED" | "INTERRUPTED" | "ENDED";

const operationsTabs: Array<{ value: OperationsTab; label: string }> = [
  { value: "operations", label: "Betrieb" },
  { value: "resources", label: "Ressourcengruppen" },
];

const resourceStatusActions: Array<{ status: ResourceGroupStatus; label: string }> = [
  { status: "ACTIVE", label: "Aktiv" },
  { status: "PAUSED", label: "Pause" },
  { status: "INTERRUPTED", label: "Unterbrochen" },
  { status: "ENDED", label: "Beendet" },
];

export interface FlightDirectorOperationsDialogProps {
  busy: boolean;
  emergencyMode: boolean;
  eventInterrupted: boolean;
  eventNotice: string;
  open: boolean;
  resourceGroups: ResourceGroup[];
  onClose: () => void;
  onPublishEventNotice: (notice: string) => Promise<boolean>;
  onPublishResourceNotice: (resourceGroupId: string, notice: string) => Promise<boolean>;
  onSetEventInterruption: (interrupted: boolean) => Promise<void>;
  onSetResourceGroupStatus: (resourceGroupId: string, status: ResourceGroupStatus) => Promise<void>;
  onTriggerEmergency: () => Promise<void>;
}

export function FlightDirectorOperationsDialog({
  busy,
  emergencyMode,
  eventInterrupted,
  eventNotice,
  open,
  resourceGroups,
  onClose,
  onPublishEventNotice,
  onPublishResourceNotice,
  onSetEventInterruption,
  onSetResourceGroupStatus,
  onTriggerEmergency,
}: FlightDirectorOperationsDialogProps) {
  const [tab, setTab] = useState<OperationsTab>("operations");
  const [eventDraft, setEventDraft] = useState(eventNotice);
  const [eventEditing, setEventEditing] = useState(false);
  const [selectedResourceGroupId, setSelectedResourceGroupId] = useState<string | null>(null);
  const [resourceDraft, setResourceDraft] = useState("");
  const openedRef = useRef(false);
  const selectedResourceGroup =
    resourceGroups.find((group) => group.id === selectedResourceGroupId) ?? null;
  const publishedEventNotice = eventNotice.trim();
  const eventEditorVisible = eventEditing || publishedEventNotice.length === 0;

  useEffect(() => {
    if (open && !openedRef.current) {
      setTab("operations");
      setEventDraft(eventNotice);
      setEventEditing(false);
      setSelectedResourceGroupId(null);
      setResourceDraft("");
    }
    openedRef.current = open;
  }, [eventNotice, open]);

  useEffect(() => {
    if (open && !eventEditing) setEventDraft(eventNotice);
  }, [eventEditing, eventNotice, open]);

  function editResourceNotice(group: ResourceGroup) {
    setSelectedResourceGroupId(group.id);
    setResourceDraft(group.operationalNote ?? "");
  }

  function returnToResources() {
    setSelectedResourceGroupId(null);
    setResourceDraft("");
    setTab("resources");
  }

  async function publishEventNotice() {
    const saved = await onPublishEventNotice(eventDraft.trim());
    if (saved) setEventEditing(false);
  }

  async function deleteEventNotice() {
    const saved = await onPublishEventNotice("");
    if (saved) {
      setEventDraft("");
      setEventEditing(false);
    }
  }

  async function publishResourceNotice() {
    if (!selectedResourceGroup) return;
    const saved = await onPublishResourceNotice(selectedResourceGroup.id, resourceDraft.trim());
    if (saved) returnToResources();
  }

  async function deleteResourceNotice() {
    if (!selectedResourceGroup) return;
    const saved = await onPublishResourceNotice(selectedResourceGroup.id, "");
    if (saved) returnToResources();
  }

  return (
    <ModalDialog
      description={
        selectedResourceGroup
          ? "Der Hinweis gilt ausschließlich für diese Ressourcengruppe."
          : "Organisatorische Betriebslage steuern. Keine Aktion besitzt flugbetriebliche oder sicherheitsbezogene Freigabewirkung."
      }
      footer={
        <Button
          onClick={selectedResourceGroup ? returnToResources : onClose}
          type="button"
          variant="secondary"
        >
          {selectedResourceGroup ? "Zurück" : "Schließen"}
        </Button>
      }
      onClose={onClose}
      open={open}
      size="wide"
      title={
        selectedResourceGroup ? `Hinweis für ${selectedResourceGroup.name}` : "Betrieb steuern"
      }
    >
      {selectedResourceGroup ? (
        <div className="flight-director-resource-notice-editor">
          <div className="flight-director-resource-notice-context">
            <strong>{selectedResourceGroup.name}</strong>
            <span>{selectedResourceGroup.shortCode}</span>
          </div>
          <TextAreaField
            autoFocus
            help="Maximal 240 Zeichen. Der Hinweis wird in den operativen Ansichten dieser Ressourcengruppe angezeigt."
            label="Hinweis"
            maxLength={240}
            onChange={(event) => setResourceDraft(event.target.value)}
            rows={4}
            value={resourceDraft}
          />
          <div className="flight-director-notice-edit-actions">
            {selectedResourceGroup.operationalNote ? (
              <Button disabled={busy} onClick={deleteResourceNotice} type="button" variant="danger">
                Löschen
              </Button>
            ) : null}
            <Button
              disabled={busy || resourceDraft.trim().length === 0}
              onClick={publishResourceNotice}
              type="button"
              variant="primary"
            >
              {selectedResourceGroup.operationalNote ? "Speichern" : "Hinweis veröffentlichen"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flight-director-operations-dialog">
          <Tabs items={operationsTabs} label="Betriebssteuerung" onChange={setTab} value={tab} />
          {tab === "operations" ? (
            <div className="flight-director-operation-panel" role="tabpanel">
              <section className="flight-director-event-notice">
                <div>
                  <h3>Veranstaltungsweiter Hinweis</h3>
                  <p>Hat in der Betriebslage Vorrang vor Hinweisen einzelner Ressourcengruppen.</p>
                </div>
                {eventEditorVisible ? (
                  <>
                    <TextAreaField
                      help="Maximal 240 Zeichen. Der Hinweis wird veranstaltungsweit veröffentlicht."
                      label="Hinweis"
                      maxLength={240}
                      onChange={(event) => setEventDraft(event.target.value)}
                      rows={4}
                      value={eventDraft}
                    />
                    <div className="flight-director-notice-edit-actions">
                      {publishedEventNotice ? (
                        <Button
                          disabled={busy}
                          onClick={() => {
                            setEventDraft(eventNotice);
                            setEventEditing(false);
                          }}
                          type="button"
                          variant="secondary"
                        >
                          Abbrechen
                        </Button>
                      ) : null}
                      <Button
                        disabled={busy || eventDraft.trim().length === 0}
                        onClick={publishEventNotice}
                        type="button"
                        variant="primary"
                      >
                        {publishedEventNotice ? "Speichern" : "Hinweis veröffentlichen"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flight-director-published-notice">
                    <p>{publishedEventNotice}</p>
                    <div>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setEventDraft(eventNotice);
                          setEventEditing(true);
                        }}
                        type="button"
                        variant="secondary"
                      >
                        Bearbeiten
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={deleteEventNotice}
                        type="button"
                        variant="danger"
                      >
                        Löschen
                      </Button>
                    </div>
                  </div>
                )}
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
                        variant={status === "ENDED" ? "danger" : "secondary"}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  <Button
                    className="flight-director-resource-notice-action"
                    disabled={busy}
                    onClick={() => editResourceNotice(group)}
                    size="compact"
                    type="button"
                    variant="secondary"
                  >
                    {group.operationalNote ? "Hinweis bearbeiten" : "Hinweis veröffentlichen"}
                  </Button>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </ModalDialog>
  );
}
