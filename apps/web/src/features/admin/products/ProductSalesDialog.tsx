import type { OperationBoard } from "@rundflug/contracts";
import { useState } from "react";
import {
  Button,
  ConfirmationDialog,
  ModalDialog,
  StatusPill,
} from "../../../design-system/components";
import { LocalizedDateTimeInput } from "../../../localized-date-input";
import { capacityLabel, predictionQualityLabel } from "../../../operation-workspace";
import "./product-sales-dialog.css";

type Product = OperationBoard["products"][number];
type EventStatus = OperationBoard["event"]["status"];

function liveSalesDescription(eventStatus: EventStatus, readOnly: boolean): string {
  if (eventStatus === "PREPARATION") return "Ab Betriebsfreigabe verfügbar";
  if (readOnly) return "Nach Betriebsende nur lesend";
  return "Die Umschaltung wird separat bestätigt und protokolliert.";
}

export function ProductSalesDialog({
  product,
  eventStatus,
  closingValue,
  busyAction,
  onClosingChange,
  onClose,
  onSaveClosing,
  onToggleSales,
}: Readonly<{
  product: Product | null;
  eventStatus: EventStatus;
  closingValue: string;
  busyAction: "closing" | "toggle" | null;
  onClosingChange: (value: string) => void;
  onClose: () => void;
  onSaveClosing: (remove: boolean) => void;
  onToggleSales: () => void;
}>) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const [initialClosingValue] = useState(closingValue);

  if (!product) return null;

  const readOnly = eventStatus === "CLOSED" || eventStatus === "ARCHIVED";
  const liveControlAvailable = eventStatus === "ACTIVE";
  const closingDirty = closingValue !== initialClosingValue;
  const busy = busyAction !== null;

  function requestClose() {
    if (busy) return;
    if (closingDirty) setDiscardOpen(true);
    else onClose();
  }

  return (
    <>
      <ModalDialog
        className="product-sales-dialog"
        description="Verkaufsschluss und Live-Verkaufsstatus werden getrennt gespeichert. Kapazität und Empfehlung sind aktuelle Boardwerte."
        footer={
          <Button disabled={busy} onClick={requestClose} type="button" variant="secondary">
            Schließen
          </Button>
        }
        initialFocusSelector="#product-sale-closes-at"
        onClose={requestClose}
        open
        portal
        size="default"
        title={`Verkauf steuern · ${product.name}`}
      >
        <section className="product-sales-status" aria-label="Verkaufskennzahlen">
          <div>
            <span>Status</span>
            <StatusPill tone={product.saleEnabled ? "success" : "neutral"}>
              {product.saleEnabled ? "Verkauf aktiv" : "Verkauf gesperrt"}
            </StatusPill>
          </div>
          <div>
            <span>Restplätze</span>
            <strong>{product.remainingSellableSeats}</strong>
          </div>
          <div>
            <span>Kapazität</span>
            <strong>{capacityLabel[product.capacityStatus]}</strong>
          </div>
          <div>
            <span>Empfehlung</span>
            <strong>{product.saleRecommended ? "Verkauf empfohlen" : "Nicht verkaufen"}</strong>
          </div>
          <div>
            <span>Prognosequalität</span>
            <strong>{predictionQualityLabel[product.predictionQuality]}</strong>
          </div>
        </section>

        <section className="product-sales-control" aria-labelledby="product-sale-closing-heading">
          <div>
            <h3 id="product-sale-closing-heading">Verkaufsschluss</h3>
            <p>Setzen oder entfernen, ohne den Live-Verkaufsstatus zu verändern.</p>
          </div>
          <LocalizedDateTimeInput
            disabled={readOnly || busy}
            id="product-sale-closes-at"
            label="Lokaler Verkaufsschluss"
            onChange={onClosingChange}
            value={closingValue}
          />
          {!readOnly ? (
            <div className="product-sales-actions">
              {product.saleClosesAt ? (
                <Button
                  disabled={busy}
                  onClick={() => onSaveClosing(true)}
                  type="button"
                  variant="danger"
                >
                  Verkaufsschluss entfernen
                </Button>
              ) : null}
              <Button
                busy={busyAction === "closing"}
                busyLabel="Verkaufsschluss wird gespeichert"
                disabled={!closingDirty || !closingValue || busy}
                onClick={() => onSaveClosing(false)}
                type="button"
                variant="primary"
              >
                Verkaufsschluss speichern
              </Button>
            </div>
          ) : null}
        </section>

        <section className="product-sales-control" aria-labelledby="product-live-sales-heading">
          <div>
            <h3 id="product-live-sales-heading">Live-Verkauf</h3>
            <p>{liveSalesDescription(eventStatus, readOnly)}</p>
          </div>
          <Button
            busy={busyAction === "toggle"}
            busyLabel="Verkaufsstatus wird geändert"
            disabled={!liveControlAvailable || closingDirty || busy}
            onClick={onToggleSales}
            type="button"
            variant={product.saleEnabled ? "danger" : "primary"}
          >
            {product.saleEnabled ? "Verkauf sperren" : "Verkauf freigeben"}
          </Button>
        </section>
      </ModalDialog>
      <ConfirmationDialog
        body={<p>Der noch nicht gespeicherte Verkaufsschluss wird verworfen.</p>}
        confirmLabel="Änderung verwerfen"
        danger
        onCancel={() => setDiscardOpen(false)}
        onConfirm={onClose}
        open={discardOpen}
        portal
        title="Verkaufsschluss verwerfen?"
      />
    </>
  );
}
