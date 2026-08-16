import type { OperationBoard } from "@rundflug/contracts";
import type { DragEvent, PointerEvent as ReactPointerEvent } from "react";
import { useState } from "react";
import { sendCommand } from "../../api";
import type { useOperationBoard } from "../operations/use-operation-board";
import { cashierProductOrderChanged, moveCashierProduct } from "./cashier-product-order";

export function useCashierProductOrder({
  board,
  busyProductId,
  confirmEvent,
  deviceId,
  deviceToken,
  eventId,
  refresh,
  setMessage,
}: {
  board: OperationBoard | null;
  busyProductId: string | null;
  confirmEvent: ReturnType<typeof useOperationBoard>["confirmEvent"];
  deviceId: string;
  deviceToken: string;
  eventId: string;
  refresh: ReturnType<typeof useOperationBoard>["refresh"];
  setMessage: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expectedProductIds, setExpectedProductIds] = useState<string[]>([]);
  const [orderedProductIds, setOrderedProductIds] = useState<string[]>([]);
  const [draggedProductId, setDraggedProductId] = useState<string | null>(null);
  const productsById = new Map((board?.products ?? []).map((product) => [product.id, product]));
  const changed = cashierProductOrderChanged(expectedProductIds, orderedProductIds);

  function open() {
    if (!board || busyProductId !== null) return;
    const productIds = board.products.map((product) => product.id);
    setExpectedProductIds(productIds);
    setOrderedProductIds(productIds);
    setDraggedProductId(null);
    setEditing(true);
  }

  function close() {
    if (saving) return;
    setEditing(false);
    setExpectedProductIds([]);
    setOrderedProductIds([]);
    setDraggedProductId(null);
  }

  function move(productId: string, targetIndex: number) {
    setOrderedProductIds((current) => moveCashierProduct(current, productId, targetIndex));
  }

  function handleDragOver(event: DragEvent<HTMLElement>, targetProductId: string) {
    event.preventDefault();
    if (!draggedProductId || draggedProductId === targetProductId) return;
    const targetIndex = orderedProductIds.indexOf(targetProductId);
    if (targetIndex >= 0) move(draggedProductId, targetIndex);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggedProductId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-cashier-product-order-id]");
    const targetProductId = target?.dataset.cashierProductOrderId;
    if (!targetProductId || targetProductId === draggedProductId) return;
    const targetIndex = orderedProductIds.indexOf(targetProductId);
    if (targetIndex >= 0) move(draggedProductId, targetIndex);
  }

  async function save() {
    if (!board || !changed || saving) return;
    setSaving(true);
    try {
      const result = await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId,
          deviceId,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "REORDER_CASHIER_PRODUCTS",
          payload: {
            expectedProductIds,
            orderedProductIds,
          },
        },
        deviceToken,
      );
      confirmEvent(result.event);
      await refresh(result.event.version).catch(() => undefined);
      setEditing(false);
      setExpectedProductIds([]);
      setOrderedProductIds([]);
      setDraggedProductId(null);
      setMessage(
        "Kassenreihenfolge gespeichert. FIDS, Queue und operative Priorität bleiben unverändert.",
      );
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : "Kassenreihenfolge konnte nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return {
    changed,
    close,
    editing,
    handleDragOver,
    handlePointerMove,
    move,
    open,
    orderedProductIds,
    productsById,
    save,
    saving,
    setDraggedProductId,
  };
}
