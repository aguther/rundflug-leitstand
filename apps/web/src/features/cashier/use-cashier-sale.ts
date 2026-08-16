import type { OperationBoard } from "@rundflug/contracts";
import { useEffect, useState } from "react";
import { sendCommand } from "../../api";
import {
  appendCashierDraftRevision,
  cashierDraftQueueKey,
  latestCashierDraft,
  legacyCashierDraftQueueKey,
  readCashierDraftQueue,
  shouldPersistCashierDraft,
  writeCashierDraftQueue,
} from "../../offline-drafts";
import { oversizeSplitPreview } from "../../operational-exceptions";
import type { OperationIdentity } from "../operations/operation-identity";
import type { useOperationBoard } from "../operations/use-operation-board";
import { measurePerformanceSafely } from "./CashierViewPresentation";
import type { useCashierReceipt } from "./use-cashier-receipt";
import type { useCashierTicketListData } from "./use-cashier-ticket-list-data";

export function useCashierSale({
  board,
  confirmEvent,
  connectionError,
  identity,
  list,
  online,
  queueHighlight,
  receipt,
  refresh,
  setMessage,
}: {
  board: OperationBoard | null;
  confirmEvent: ReturnType<typeof useOperationBoard>["confirmEvent"];
  connectionError: string | null;
  identity: OperationIdentity;
  list: Pick<
    ReturnType<typeof useCashierTicketListData>,
    "lastBoardVersionRef" | "load" | "mergeById" | "setSelectedTicketGroupId"
  >;
  online: boolean;
  queueHighlight: (ticketGroupId: string) => void;
  receipt: Pick<
    ReturnType<typeof useCashierReceipt>,
    "beginRequest" | "isCurrentRequest" | "reopen"
  >;
  refresh: ReturnType<typeof useOperationBoard>["refresh"];
  setMessage: (message: string | null) => void;
}) {
  const draftQueueKey = cashierDraftQueueKey(identity.eventId, identity.deviceId);
  const initialDraftQueue = readCashierDraftQueue(localStorage, draftQueueKey);
  const initialDraft = latestCashierDraft(initialDraftQueue);
  const [productId, setProductId] = useState(() => initialDraft?.productId ?? "panorama-20");
  const [size, setSize] = useState(() => initialDraft?.size ?? 1);
  const [pendingDraftCount, setPendingDraftCount] = useState(initialDraftQueue.length);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [syncCount, setSyncCount] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    localStorage.removeItem(legacyCashierDraftQueueKey(identity.eventId, identity.deviceId));
  }, [identity.deviceId, identity.eventId]);

  function changeGroupSize(nextSize: number) {
    setSize(nextSize);
    if (
      !shouldPersistCashierDraft({
        hasPendingDraft: pendingDraftCount > 0,
        online,
        connectionError,
      })
    ) {
      return;
    }
    const queue = appendCashierDraftRevision(readCashierDraftQueue(localStorage, draftQueueKey), {
      productId,
      size: nextSize,
    });
    writeCashierDraftQueue(localStorage, draftQueueKey, queue);
    setPendingDraftCount(queue.length);
  }

  async function sell(saleProduct: OperationBoard["products"][number]) {
    if (!board || busyProductId) return;
    const saleStartedAt = performance.now();
    const splitPreview = oversizeSplitPreview(size, saleProduct.referenceCapacity);
    setProductId(saleProduct.id);
    setBusyProductId(saleProduct.id);
    let saleResult: Awaited<ReturnType<typeof sendCommand>>;
    try {
      saleResult = await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: identity.eventId,
          deviceId: identity.deviceId,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "SELL_TICKET_GROUP",
          payload: {
            productId: saleProduct.id,
            ticketCount: size,
            standby: false,
            paymentStatus: "INFORMATIONAL_ONLY",
            paymentMethod: null,
            oversizeSplitAcknowledged: splitPreview.required,
          },
        },
        identity.deviceToken,
      );
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Verkauf fehlgeschlagen.");
      setBusyProductId(null);
      return;
    }

    const soldTicketGroupId = saleResult.aggregate?.id ?? null;
    list.lastBoardVersionRef.current = saleResult.event.version;
    confirmEvent(saleResult.event);
    list.setSelectedTicketGroupId(soldTicketGroupId);
    setBusyProductId(null);
    setMessage(null);
    setAnnouncement(`${size} Ticket${size === 1 ? "" : "s"} verkauft.`);
    if (soldTicketGroupId) queueHighlight(soldTicketGroupId);
    measurePerformanceSafely("rundflug:cashier-sale-ready", saleStartedAt);
    try {
      writeCashierDraftQueue(localStorage, draftQueueKey, []);
      setPendingDraftCount(0);
    } catch {
      setMessage(
        `${size} Ticket${size === 1 ? "" : "s"} verkauft. Der lokale Entwurf konnte noch nicht bereinigt werden; Ansicht und Beleg werden aktualisiert.`,
      );
    }
    const receiptRequestToken = receipt.beginRequest();
    setSyncCount((current) => current + 1);
    void (async () => {
      try {
        const printTask = soldTicketGroupId
          ? receipt.reopen(soldTicketGroupId, saleResult.saleReceipt, receiptRequestToken)
          : Promise.resolve(true);
        const targetedListTask = soldTicketGroupId
          ? list.mergeById([soldTicketGroupId])
          : Promise.reject(new Error("Die bestätigte Buchungsgruppe fehlt."));
        const [printResult, boardResult, targetedListResult] = await Promise.allSettled([
          printTask,
          refresh(saleResult.event.version),
          targetedListTask,
        ]);
        await list.load({ preserveLoaded: true, reportError: false });
        const printPrepared = printResult.status === "fulfilled" && printResult.value;
        const synchronized =
          boardResult.status === "fulfilled" && targetedListResult.status === "fulfilled";
        if (receipt.isCurrentRequest(receiptRequestToken) && !(printPrepared && synchronized)) {
          setMessage(
            `${size} Ticket${size === 1 ? "" : "s"} verkauft. Ansicht oder Druckvorbereitung wird weiter nachgeladen; Nachdruck bleibt möglich.`,
          );
        }
      } catch {
        if (receipt.isCurrentRequest(receiptRequestToken)) {
          setMessage(
            `${size} Ticket${size === 1 ? "" : "s"} verkauft. Ansicht und Beleg werden weiter nachgeladen; Nachdruck bleibt möglich.`,
          );
        }
      } finally {
        measurePerformanceSafely("rundflug:cashier-sale-synchronized", saleStartedAt);
        setSyncCount((current) => Math.max(0, current - 1));
      }
    })();
  }

  return {
    announcement,
    busyProductId,
    changeGroupSize,
    pendingDraftCount,
    sell,
    size,
    syncCount,
  };
}
