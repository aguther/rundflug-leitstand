import type { OperationBoard } from "@rundflug/contracts";
import { ListOrdered, Minus, Plus, RefreshCw, RotateCcw } from "lucide-react";
import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { IconButton, PageHeader, Panel } from "../../design-system/components";
import { CashierProductList } from "./CashierProductList";
import { CashierProductOrderEditor } from "./CashierProductOrderEditor";
import { CashierCapacityGuidance } from "./CashierViewPresentation";

type CashierProduct = OperationBoard["products"][number];

export interface CashierSalePanelProps {
  board: OperationBoard | null;
  busyProductId: string | null;
  currency: (cents: number) => string;
  order: {
    changed: boolean;
    editing: boolean;
    orderedProductIds: string[];
    productsById: ReadonlyMap<string, CashierProduct>;
    saving: boolean;
  };
  onChangeGroupSize: (size: number) => void;
  onCloseOrderEditor: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, productId: string) => void;
  onDraggedProductChange: (productId: string | null) => void;
  onMoveProduct: (productId: string, targetIndex: number) => void;
  onOpenOrderEditor: () => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onSaveOrder: () => void;
  onSell: (product: CashierProduct) => void;
  saleSyncCount: number;
  serverConfirmed: boolean;
  size: number;
}

export function CashierSalePanel(props: Readonly<CashierSalePanelProps>) {
  const { board, busyProductId, order, saleSyncCount, serverConfirmed, size } = props;
  return (
    <Panel className="cashier-sale-panel" aria-labelledby="cashier-sale-title">
      <div className="cashier-sale-heading">
        <div className="cashier-sale-title">
          <PageHeader
            level={1}
            title={order.editing ? "Kassen-Reihenfolge" : "Tickets verkaufen"}
          />
          {order.editing ? (
            <p>Nur Kassenreihenfolge · FIDS, Queue und operative Priorität bleiben dynamisch</p>
          ) : null}
        </div>
        {!order.editing ? (
          <div className="cashier-group-size">
            <div className="cashier-group-size-main">
              <span className="cashier-field-label">Gruppengröße</span>
              <div className="cashier-stepper">
                <IconButton
                  label="Gruppengröße verringern"
                  onClick={() => props.onChangeGroupSize(Math.max(1, size - 1))}
                  type="button"
                >
                  <Minus aria-hidden="true" size={18} />
                </IconButton>
                <output aria-live="polite">{size}</output>
                <IconButton
                  label="Gruppengröße erhöhen"
                  onClick={() => props.onChangeGroupSize(Math.min(12, size + 1))}
                  type="button"
                >
                  <Plus aria-hidden="true" size={18} />
                </IconButton>
              </div>
              <IconButton
                className="cashier-size-reset"
                disabled={size === 1 || busyProductId !== null}
                label="Gruppengröße auf 1 zurücksetzen"
                onClick={() => props.onChangeGroupSize(1)}
                size="touch"
                type="button"
              >
                <RotateCcw aria-hidden="true" size={18} />
              </IconButton>
            </div>
            <div className="cashier-group-actions">
              <span
                aria-live="polite"
                className={`cashier-sale-sync${saleSyncCount > 0 ? " is-active" : ""}`}
                role="status"
                title={saleSyncCount > 0 ? "Verkaufsansicht wird aktualisiert" : undefined}
              >
                <RefreshCw aria-hidden="true" className="cashier-sale-sync-icon" size={17} />
                <span className="visually-hidden">
                  {saleSyncCount > 0 ? "Verkaufsansicht wird aktualisiert" : ""}
                </span>
              </span>
              <IconButton
                className="cashier-order-open"
                disabled={
                  !serverConfirmed || busyProductId !== null || (board?.products.length ?? 0) < 2
                }
                label="Kassenreihenfolge bearbeiten"
                onClick={props.onOpenOrderEditor}
                size="touch"
                type="button"
              >
                <ListOrdered aria-hidden="true" size={19} />
              </IconButton>
            </div>
          </div>
        ) : null}
      </div>
      {!order.editing ? <CashierCapacityGuidance products={board?.products} /> : null}
      {order.editing ? (
        <CashierProductOrderEditor
          changed={order.changed}
          onCancel={props.onCloseOrderEditor}
          onDragOver={props.onDragOver}
          onDraggedProductChange={props.onDraggedProductChange}
          onMove={props.onMoveProduct}
          onPointerMove={props.onPointerMove}
          onSave={props.onSaveOrder}
          orderedProductIds={order.orderedProductIds}
          productsById={order.productsById}
          saving={order.saving}
        />
      ) : (
        <CashierProductList
          board={board}
          busyProductId={busyProductId}
          currency={props.currency}
          onSell={props.onSell}
          serverConfirmed={serverConfirmed}
          size={size}
        />
      )}
    </Panel>
  );
}
