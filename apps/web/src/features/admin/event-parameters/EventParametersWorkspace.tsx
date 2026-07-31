import type { EventLogoTheme, EventSnapshot } from "@rundflug/contracts";
import { AlertTriangle, RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  CheckboxField,
  ConfirmationDialog,
  StatusPill,
  Tabs,
} from "../../../design-system/components";
import { formatGermanDate, LocalizedDateTimeInput } from "../../../localized-date-input";
import { EventAppearancePanel } from "./EventAppearancePanel";
import { NumberFieldWithUnit } from "./NumberFieldWithUnit";
import { useEventParametersForm, type ValidEventParameterPayload } from "./useEventParametersForm";

const WORKSPACE_TABS = [
  { value: "parameters", label: "Parameter" },
  { value: "appearance", label: "Darstellung" },
] as const;

export type EventParameterSaveLifecycle = {
  onSaved: () => void;
  onConflict: (currentVersion?: number) => void;
};

function eventStatusLabel(status: EventSnapshot["status"]): string {
  if (status === "PREPARATION") return "Vorbereitung";
  if (status === "ACTIVE") return "Aktiv";
  if (status === "CLOSED") return "Geschlossen";
  return "Archiviert";
}

export function EventParametersWorkspace({
  event,
  administrator,
  busyActionKey,
  onDirtyChange,
  onSave,
  onUploadLogo,
  onRemoveLogo,
}: {
  event: EventSnapshot;
  administrator: boolean;
  busyActionKey: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (payload: ValidEventParameterPayload, lifecycle: EventParameterSaveLifecycle) => void;
  onUploadLogo: (theme: EventLogoTheme, file: File) => void;
  onRemoveLogo: (theme: EventLogoTheme) => void;
}) {
  const [activeTab, setActiveTab] = useState<"parameters" | "appearance">("parameters");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const form = useEventParametersForm(event);
  const errors = submitAttempted ? form.validation.errors : {};
  const groundMinutes = useMemo(() => {
    const values = [
      form.values.plannedBoardingMinutes,
      form.values.plannedDeboardingMinutes,
      form.values.plannedBufferMinutes,
    ].map(Number);
    return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null;
  }, [
    form.values.plannedBoardingMinutes,
    form.values.plannedBufferMinutes,
    form.values.plannedDeboardingMinutes,
  ]);

  useEffect(() => onDirtyChange(form.dirty), [form.dirty, onDirtyChange]);

  function setStringValue(field: Parameters<typeof form.setValue>[0], value: string | boolean) {
    form.setValue(field, value);
  }

  function requestSave() {
    setSubmitAttempted(true);
    if (!form.validation.payload) {
      window.requestAnimationFrame(() =>
        workspaceRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    onSave(form.validation.payload, {
      onSaved: () => {
        form.markSaved();
        setSubmitAttempted(false);
      },
      onConflict: form.markConflict,
    });
  }

  return (
    <div className="event-parameters-workspace" ref={workspaceRef}>
      <header className="event-parameters-header">
        <div className="event-parameters-title">
          <div>
            <span>Veranstaltung</span>
            <h2>{event.name}</h2>
          </div>
          <StatusPill tone={event.status === "ACTIVE" ? "success" : "neutral"}>
            {eventStatusLabel(event.status)}
          </StatusPill>
        </div>
        <dl className="event-parameters-meta">
          <div>
            <dt>Datum</dt>
            <dd>{formatGermanDate(event.eventDate)}</dd>
          </div>
          <div>
            <dt>Flugplatz</dt>
            <dd>{event.aerodrome}</dd>
          </div>
          <div>
            <dt>Zeitzone</dt>
            <dd>{event.timeZone}</dd>
          </div>
        </dl>
        <div className="event-parameters-actions">
          <Button
            disabled={!form.dirty || busyActionKey !== null}
            onClick={() => setDiscardOpen(true)}
            size="compact"
            variant="secondary"
          >
            <RotateCcw aria-hidden="true" />
            Verwerfen
          </Button>
          <Button
            busy={busyActionKey === "event-parameters"}
            disabled={
              !administrator ||
              !form.dirty ||
              form.validation.payload === null ||
              form.conflictVersion !== null
            }
            onClick={requestSave}
            size="compact"
            variant="primary"
          >
            <Save aria-hidden="true" />
            Speichern
          </Button>
        </div>
      </header>

      <Tabs
        items={[...WORKSPACE_TABS]}
        label="Veranstaltungsparameter"
        onChange={setActiveTab}
        value={activeTab}
      />

      {form.conflictVersion !== null ? (
        <div className="event-parameter-conflict" role="alert">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>Neuere Serverversion verfügbar</strong>
            <p>
              Die Veranstaltung wurde parallel geändert. Die lokalen Eingaben werden nicht
              überschrieben. Verwirf sie, um Version {form.conflictVersion} zu übernehmen.
            </p>
          </div>
          <Button onClick={() => setDiscardOpen(true)} size="compact" variant="secondary">
            Serverstand übernehmen
          </Button>
        </div>
      ) : null}

      <div className="event-parameters-content">
        {activeTab === "parameters" ? (
          <div className="event-parameter-card-grid">
            <section className="event-parameter-card event-period-card">
              <div className="event-parameter-section-heading">
                <div>
                  <h3>Betriebszeitraum</h3>
                  <p>Lokale Zeiten in {event.timeZone}.</p>
                </div>
              </div>
              <div className="event-period-fields">
                <LocalizedDateTimeInput
                  error={errors.saleOpensAt}
                  id="event-sale-opens-at"
                  label="Verkaufsbeginn"
                  onChange={(value) => setStringValue("saleOpensAt", value)}
                  value={form.values.saleOpensAt}
                />
                <LocalizedDateTimeInput
                  error={errors.operationsStartAt}
                  id="event-operations-start-at"
                  label="Betriebsbeginn (Plan)"
                  onChange={(value) => setStringValue("operationsStartAt", value)}
                  value={form.values.operationsStartAt}
                />
                <LocalizedDateTimeInput
                  error={errors.operationsEndAt}
                  id="event-operations-end-at"
                  label="Betriebsende"
                  onChange={(value) => setStringValue("operationsEndAt", value)}
                  required
                  value={form.values.operationsEndAt}
                />
              </div>
            </section>

            <section className="event-parameter-card turnaround-card">
              <div className="event-parameter-section-heading">
                <div>
                  <h3>Standard-Umlaufzeiten</h3>
                  <p>Veranstaltungsweite Defaults für die Bodenphasen.</p>
                </div>
                <strong className="event-ground-total">
                  Bodenzeit {groundMinutes === null ? "–" : `${groundMinutes} Min.`}
                </strong>
              </div>
              <div className="event-turnaround-fields">
                <NumberFieldWithUnit
                  error={errors.plannedBoardingMinutes}
                  label="Boarding"
                  maximum={120}
                  minimum={1}
                  onChange={(value) => setStringValue("plannedBoardingMinutes", value)}
                  unit="Min."
                  value={form.values.plannedBoardingMinutes}
                />
                <span aria-hidden="true">+</span>
                <NumberFieldWithUnit
                  error={errors.plannedDeboardingMinutes}
                  label="Ausstieg"
                  maximum={120}
                  minimum={1}
                  onChange={(value) => setStringValue("plannedDeboardingMinutes", value)}
                  unit="Min."
                  value={form.values.plannedDeboardingMinutes}
                />
                <span aria-hidden="true">+</span>
                <NumberFieldWithUnit
                  error={errors.plannedBufferMinutes}
                  label="Puffer"
                  maximum={120}
                  minimum={0}
                  onChange={(value) => setStringValue("plannedBufferMinutes", value)}
                  unit="Min."
                  value={form.values.plannedBufferMinutes}
                />
              </div>
            </section>

            <section className="event-parameter-card">
              <div className="event-parameter-section-heading">
                <div>
                  <h3>Gruppen und Benachrichtigungen</h3>
                  <p>Organisatorische Fristen und automatischer Voraufruf.</p>
                </div>
              </div>
              <div className="event-parameter-fields">
                <NumberFieldWithUnit
                  error={errors.noShowAfterMinutes}
                  label="No-Show nach"
                  maximum={120}
                  minimum={1}
                  onChange={(value) => setStringValue("noShowAfterMinutes", value)}
                  unit="Min."
                  value={form.values.noShowAfterMinutes}
                />
                <NumberFieldWithUnit
                  error={errors.maxTicketDeferrals}
                  label="Klärung nach Zurückstellungen"
                  maximum={10}
                  minimum={1}
                  onChange={(value) => setStringValue("maxTicketDeferrals", value)}
                  unit="Mal"
                  value={form.values.maxTicketDeferrals}
                />
                <NumberFieldWithUnit
                  error={errors.notificationLeadMinutes}
                  label="Benachrichtigungsvorlauf"
                  maximum={240}
                  minimum={1}
                  onChange={(value) => setStringValue("notificationLeadMinutes", value)}
                  unit="Min."
                  value={form.values.notificationLeadMinutes}
                />
              </div>
              <CheckboxField
                checked={form.values.automaticPrecallEnabled}
                label="Gruppen automatisch zum Gate voraufrufen"
                onChange={(inputEvent) =>
                  setStringValue("automaticPrecallEnabled", inputEvent.target.checked)
                }
              />
            </section>

            <section className="event-parameter-card">
              <div className="event-parameter-section-heading">
                <div>
                  <h3>Referenzgewichte</h3>
                  <p>Reine Planungshinweise ohne Freigabesemantik.</p>
                </div>
              </div>
              <div className="event-parameter-fields">
                <NumberFieldWithUnit
                  error={errors.childReferenceWeightKg}
                  label="Kind"
                  maximum={300}
                  minimum={0.01}
                  onChange={(value) => setStringValue("childReferenceWeightKg", value)}
                  step={0.1}
                  unit="kg"
                  value={form.values.childReferenceWeightKg}
                />
                <NumberFieldWithUnit
                  error={errors.normalReferenceWeightKg}
                  label="Standard"
                  maximum={300}
                  minimum={0.01}
                  onChange={(value) => setStringValue("normalReferenceWeightKg", value)}
                  step={0.1}
                  unit="kg"
                  value={form.values.normalReferenceWeightKg}
                />
                <NumberFieldWithUnit
                  error={errors.heavyReferenceWeightKg}
                  label="Erhöht"
                  maximum={300}
                  minimum={0.01}
                  onChange={(value) => setStringValue("heavyReferenceWeightKg", value)}
                  step={0.1}
                  unit="kg"
                  value={form.values.heavyReferenceWeightKg}
                />
              </div>
            </section>

            <section className="event-parameter-card">
              <div className="event-parameter-section-heading">
                <div>
                  <h3>Anzeigeverhalten</h3>
                  <p>Darstellungsdauer abgeschlossener Statuszeilen.</p>
                </div>
              </div>
              <div className="event-parameter-fields">
                <NumberFieldWithUnit
                  error={errors.departedVisibilitySeconds}
                  label="Abgeflogene Zeilen sichtbar"
                  maximum={900}
                  minimum={5}
                  onChange={(value) => setStringValue("departedVisibilitySeconds", value)}
                  unit="Sek."
                  value={form.values.departedVisibilitySeconds}
                />
              </div>
            </section>
          </div>
        ) : (
          <EventAppearancePanel
            administrator={administrator}
            busyActionKey={busyActionKey}
            eventId={event.eventId}
            eventVersion={event.version}
            logoVariants={event.logoVariants ?? { light: false, dark: false }}
            onRemove={onRemoveLogo}
            onUpload={onUploadLogo}
          />
        )}
      </div>

      <div className="event-parameters-mobile-actions">
        <Button
          disabled={!form.dirty || busyActionKey !== null}
          onClick={() => setDiscardOpen(true)}
          variant="secondary"
        >
          <RotateCcw aria-hidden="true" />
          Verwerfen
        </Button>
        <Button
          disabled={
            !administrator ||
            !form.dirty ||
            form.validation.payload === null ||
            form.conflictVersion !== null
          }
          onClick={requestSave}
          variant="primary"
        >
          <Save aria-hidden="true" />
          Änderungen speichern
        </Button>
      </div>

      <ConfirmationDialog
        body={
          <p>
            Alle noch nicht gespeicherten Änderungen an den Veranstaltungsparametern gehen verloren.
          </p>
        }
        confirmLabel={
          form.conflictVersion === null ? "Änderungen verwerfen" : "Serverstand übernehmen"
        }
        danger={form.conflictVersion === null}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          form.discard();
          setSubmitAttempted(false);
          setDiscardOpen(false);
        }}
        open={discardOpen}
        title="Ungespeicherte Änderungen verwerfen?"
      />
    </div>
  );
}
