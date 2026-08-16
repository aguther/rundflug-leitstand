import type { OperationBoard } from "@rundflug/contracts";
import { useState } from "react";
import { sendCommand } from "../../api";
import { AppShell as Shell } from "../../app/AppShell";
import { useActionMessageBridge } from "../../app/PageNotifications";
import { useUpdateBlocker } from "../../app/PwaUpdate";
import { useConnectivity } from "../../shared/hooks/use-connectivity";
import { formatAbsoluteTimeWindow } from "../../time-window";
import { useAuth } from "../auth/AuthContext";
import { useOperationIdentity } from "../operations/operation-identity";
import { useOperationBoard } from "../operations/use-operation-board";
import { CashierSalePanel } from "./CashierSalePanel";
import { CashierTicketPanel } from "./CashierTicketPanel";
import { CashierNotifications, rotationTimeWindowPhase } from "./CashierViewPresentation";
import { CashierWorkspaceDialogs } from "./CashierWorkspaceDialogs";
import { useCashierProductOrder } from "./use-cashier-product-order";
import { useCashierReceipt } from "./use-cashier-receipt";
import { useCashierSale } from "./use-cashier-sale";
import { useCashierTicketList } from "./use-cashier-ticket-list";

export function CashierWorkspace() {
  const { session } = useAuth();
  const cashierIdentity = useOperationIdentity("CASHIER", "cashier-tablet-1");
  const { eventId: EVENT_ID, deviceId: CASHIER_DEVICE_ID, deviceToken } = cashierIdentity;
  const { board, error, lastConfirmedAt, backendConfirmed, confirmEvent, refresh } =
    useOperationBoard(cashierIdentity);
  const online = useConnectivity();
  const serverConfirmed = online && backendConfirmed && error === null;
  const [message, setMessage] = useState<string | null>(null);
  useActionMessageBridge(message, setMessage);
  const receipt = useCashierReceipt({
    deviceId: CASHIER_DEVICE_ID,
    deviceToken,
    eventId: EVENT_ID,
    setMessage,
  });
  const ticketList = useCashierTicketList({
    board,
    clearReceipt: receipt.clear,
    identity: cashierIdentity,
    serverConfirmed,
    sessionAccountId: session?.account.id,
    setMessage,
  });
  const sale = useCashierSale({
    board,
    confirmEvent,
    connectionError: error,
    identity: cashierIdentity,
    list: ticketList.data,
    online,
    queueHighlight: ticketList.queueHighlight,
    receipt,
    refresh,
    setMessage,
  });
  const productOrder = useCashierProductOrder({
    board,
    busyProductId: sale.busyProductId,
    confirmEvent,
    deviceId: CASHIER_DEVICE_ID,
    deviceToken,
    eventId: EVENT_ID,
    refresh,
    setMessage,
  });
  const [cancelReason, setCancelReason] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  useUpdateBlocker(
    "dirty",
    "cashier-sale-draft",
    sale.size !== 1 || sale.pendingDraftCount > 0 || (productOrder.editing && productOrder.changed),
  );
  const currency = (cents: number) =>
    (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  async function cancelLastSale() {
    if (
      !board ||
      !ticketList.data.selectedTicketGroupId ||
      cancelReason.trim().length < 3 ||
      cancelBusy
    )
      return;
    setCancelBusy(true);
    try {
      await sendCommand(
        {
          commandId: crypto.randomUUID(),
          eventId: EVENT_ID,
          deviceId: CASHIER_DEVICE_ID,
          expectedVersion: board.event.version,
          issuedAt: new Date().toISOString(),
          type: "CANCEL_TICKET_GROUP",
          payload: {
            ticketGroupId: ticketList.data.selectedTicketGroupId,
            reason: cancelReason.trim(),
            adminPin: "SESSION",
          },
        },
        deviceToken,
      );
      setMessage("Verkauf storniert und Kapazität freigegeben.");
      receipt.clear();
      setCancelReason("");
      setCancelDialogOpen(false);
      ticketList.setTab("CANCELED");
      await Promise.all([
        refresh(),
        ticketList.data.load({ status: "CANCELED", query: ticketList.query }),
      ]);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Storno fehlgeschlagen.");
    } finally {
      setCancelBusy(false);
    }
  }

  function rotationTimeWindow(rotation: OperationBoard["rotations"][number]) {
    return formatAbsoluteTimeWindow({
      lowerAt: rotation.boardingWindowLowerAt,
      upperAt: rotation.boardingWindowUpperAt,
      timeZone: board?.event.timeZone ?? "Europe/Berlin",
      variant: "compact",
      quality: rotation.timeline.predictionQuality,
      phase: rotationTimeWindowPhase(rotation),
    });
  }

  return (
    <Shell
      className="cashier-shell"
      connection={{ backendConfirmed, error, lastConfirmedAt }}
      title="Kasse"
      notifications={
        <CashierNotifications
          error={error}
          lastConfirmedAt={lastConfirmedAt}
          pendingDraftCount={sale.pendingDraftCount}
          serverConfirmed={serverConfirmed}
          board={board}
        />
      }
    >
      <p aria-live="polite" className="visually-hidden">
        {sale.announcement}
      </p>
      <section className="cashier-v15-workspace">
        <CashierSalePanel
          board={board}
          busyProductId={sale.busyProductId}
          currency={currency}
          order={{
            changed: productOrder.changed,
            editing: productOrder.editing,
            orderedProductIds: productOrder.orderedProductIds,
            productsById: productOrder.productsById,
            saving: productOrder.saving,
          }}
          onChangeGroupSize={sale.changeGroupSize}
          onCloseOrderEditor={productOrder.close}
          onDragOver={productOrder.handleDragOver}
          onDraggedProductChange={productOrder.setDraggedProductId}
          onMoveProduct={productOrder.move}
          onOpenOrderEditor={productOrder.open}
          onPointerMove={productOrder.handlePointerMove}
          onSaveOrder={() => void productOrder.save()}
          onSell={(product) => void sale.sell(product)}
          saleSyncCount={sale.syncCount}
          serverConfirmed={serverConfirmed}
          size={sale.size}
        />
        <CashierTicketPanel
          accounts={ticketList.accounts}
          accountFilter={ticketList.accountFilter}
          board={board}
          currency={currency}
          highlightedIds={ticketList.highlightedIds}
          lastTicketGroupId={ticketList.data.selectedTicketGroupId}
          loading={ticketList.data.loading}
          manualRefreshBusy={ticketList.manualRefreshBusy}
          nextCursor={ticketList.data.nextCursor}
          onlyOwnTickets={ticketList.onlyOwnTickets}
          printBusy={receipt.printBusy}
          receipt={receipt.receipt}
          rotations={ticketList.selectedRotations}
          rows={ticketList.visibleGroups}
          search={ticketList.search}
          selectedTicketGroup={ticketList.selectedTicketGroup}
          sentinelRef={ticketList.data.sentinelRef}
          sessionAvailable={Boolean(session)}
          tab={ticketList.tab}
          onAccountFilterChange={ticketList.changeAccountFilter}
          onCancel={() => setCancelDialogOpen(true)}
          onEnlarge={receipt.openQrScan}
          onOnlyOwnTicketsChange={ticketList.changeOnlyOwnTickets}
          onOpenTicketGroup={(result) => {
            ticketList.select(result);
            if (result.groupStatus !== "CANCELED") void receipt.reopen(result.ticketGroupId);
          }}
          onPrint={() => void receipt.print(ticketList.selectedTicketGroup)}
          onRefresh={() => void ticketList.refresh()}
          onRunSearch={ticketList.runSearch}
          onSearchChange={ticketList.setSearch}
          onTabChange={ticketList.setTab}
          rotationTimeWindow={rotationTimeWindow}
        />
      </section>
      <CashierWorkspaceDialogs
        cancelBusy={cancelBusy}
        cancelDialogOpen={cancelDialogOpen}
        cancelReason={cancelReason}
        onCancelDialogClose={() => {
          if (cancelBusy) return;
          setCancelDialogOpen(false);
          setCancelReason("");
        }}
        onCancelReasonChange={setCancelReason}
        onCancelSale={() => void cancelLastSale()}
        onQrScanClose={receipt.closeQrScan}
        printDocumentRef={receipt.printDocumentRef}
        qrScanOpen={receipt.qrScanOpen}
        receipt={receipt.receipt}
        selectedTicketGroup={ticketList.selectedTicketGroup}
      />
    </Shell>
  );
}
