import type { TicketSearchResult } from "@rundflug/contracts";
import type { RefObject } from "react";
import { ConfirmationDialog, TextField } from "../../design-system/components";
import type { TicketReceipt } from "../operations/operation-types";
import { QrScanDialog } from "./CashierTicketPresentation";
import { cancellationDescription, printableTicketDocument } from "./CashierViewPresentation";

export function CashierWorkspaceDialogs({
  cancelBusy,
  cancelDialogOpen,
  cancelReason,
  onCancelDialogClose,
  onCancelReasonChange,
  onCancelSale,
  onQrScanClose,
  printDocumentRef,
  qrScanOpen,
  receipt,
  selectedTicketGroup,
}: Readonly<{
  cancelBusy: boolean;
  cancelDialogOpen: boolean;
  cancelReason: string;
  onCancelDialogClose: () => void;
  onCancelReasonChange: (reason: string) => void;
  onCancelSale: () => void;
  onQrScanClose: () => void;
  printDocumentRef: RefObject<HTMLDivElement | null>;
  qrScanOpen: boolean;
  receipt: TicketReceipt | null;
  selectedTicketGroup: TicketSearchResult | undefined;
}>) {
  return (
    <>
      <div className="ticket-print-document" ref={printDocumentRef} aria-hidden="true">
        {printableTicketDocument(receipt)}
      </div>
      <QrScanDialog
        onClose={onQrScanClose}
        open={qrScanOpen && Boolean(receipt)}
        ticket={receipt ?? undefined}
      />
      <ConfirmationDialog
        open={cancelDialogOpen}
        title="Tickets stornieren"
        body={
          <div className="cashier-cancel-dialog-body">
            <p>{cancellationDescription(selectedTicketGroup)}</p>
            <TextField
              autoFocus
              label="Grund"
              value={cancelReason}
              onChange={(event) => onCancelReasonChange(event.target.value)}
              placeholder="Mindestens 3 Zeichen"
            />
          </div>
        }
        confirmDisabled={cancelReason.trim().length < 3}
        confirmBusy={cancelBusy}
        confirmLabel="Stornieren"
        danger
        onCancel={onCancelDialogClose}
        onConfirm={onCancelSale}
      />
    </>
  );
}
