import type { OperationBoard } from "@rundflug/contracts";
import { Button, ModalDialog } from "../../../design-system/components";
import { LocalizedDateTimeInput } from "../../../localized-date-input";

type Product = OperationBoard["products"][number];

export function ProductSalesClosingDialog({
  product,
  value,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  product: Product | null;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: (remove: boolean) => void;
}) {
  return (
    <ModalDialog
      description="Nur der produktspezifische Verkaufsschluss wird geändert. Freigabe, Warn- und Kritischschwelle bleiben unverändert."
      footer={
        <>
          <Button disabled={busy} onClick={onClose} type="button">
            Abbrechen
          </Button>
          {product?.saleClosesAt ? (
            <Button disabled={busy} onClick={() => onSave(true)} type="button" variant="danger">
              Verkaufsschluss entfernen
            </Button>
          ) : null}
          <Button
            busy={busy}
            disabled={!value || busy}
            onClick={() => onSave(false)}
            type="button"
            variant="primary"
          >
            Verkaufsschluss speichern
          </Button>
        </>
      }
      initialFocusSelector="#product-sale-closes-at"
      onClose={onClose}
      open={product !== null}
      portal
      size="compact"
      title={product ? `Verkaufsschluss · ${product.name}` : "Verkaufsschluss"}
    >
      <LocalizedDateTimeInput
        id="product-sale-closes-at"
        label="Lokaler Verkaufsschluss"
        onChange={onChange}
        value={value}
      />
    </ModalDialog>
  );
}
