import type { OperationBoard } from "@rundflug/contracts";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { Button, IconButton } from "../../design-system/components";

type CashierProduct = OperationBoard["products"][number];

export function CashierProductOrderEditor({
  changed,
  onCancel,
  onDragOver,
  onDraggedProductChange,
  onMove,
  onPointerMove,
  onSave,
  orderedProductIds,
  productsById,
  saving,
}: Readonly<{
  changed: boolean;
  onCancel: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, productId: string) => void;
  onDraggedProductChange: (productId: string | null) => void;
  onMove: (productId: string, targetIndex: number) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onSave: () => void;
  orderedProductIds: string[];
  productsById: ReadonlyMap<string, CashierProduct>;
  saving: boolean;
}>) {
  return (
    <>
      <ol aria-label="Kassenreihenfolge der Produkte" className="cashier-order-editor">
        {orderedProductIds.map((productId, index) => {
          const product = productsById.get(productId);
          if (!product) return null;
          return (
            <li
              className="cashier-order-row"
              data-cashier-product-order-id={productId}
              key={productId}
              onDragOver={(event) => onDragOver(event, productId)}
            >
              <button
                aria-label={`${product.name} ziehen`}
                className="cashier-order-drag"
                disabled={saving}
                draggable={!saving}
                onDragEnd={() => onDraggedProductChange(null)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", productId);
                  onDraggedProductChange(productId);
                }}
                onPointerCancel={() => onDraggedProductChange(null)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onDraggedProductChange(productId);
                }}
                onPointerMove={onPointerMove}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  onDraggedProductChange(null);
                }}
                title={`${product.name} ziehen`}
                type="button"
              >
                <GripVertical aria-hidden="true" size={20} />
              </button>
              <span className="cashier-order-position">
                <span className="visually-hidden">Position </span>
                {index + 1}
              </span>
              <span className="cashier-order-product">
                <strong>{product.name}</strong>
                <small>{product.code}</small>
              </span>
              <div className="cashier-order-actions">
                <IconButton
                  disabled={index === 0 || saving}
                  label={`${product.name} nach oben verschieben`}
                  onClick={() => onMove(productId, index - 1)}
                  size="touch"
                  type="button"
                >
                  <ArrowUp aria-hidden="true" size={19} />
                </IconButton>
                <IconButton
                  disabled={index === orderedProductIds.length - 1 || saving}
                  label={`${product.name} nach unten verschieben`}
                  onClick={() => onMove(productId, index + 1)}
                  size="touch"
                  type="button"
                >
                  <ArrowDown aria-hidden="true" size={19} />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="cashier-order-footer">
        <Button disabled={saving} onClick={onCancel} type="button" variant="secondary">
          Abbrechen
        </Button>
        <Button
          busy={saving}
          busyLabel="Kassenreihenfolge wird gespeichert"
          disabled={!changed}
          onClick={onSave}
          type="button"
          variant="primary"
        >
          Speichern
        </Button>
      </div>
    </>
  );
}
