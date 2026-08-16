import type { TicketGroupPrintData, TicketSearchResult } from "@rundflug/contracts";
import QRCode from "qrcode";
import { useCallback, useRef, useState } from "react";
import { getTicketGroupPrintData } from "../../api";
import type { TicketReceipt } from "../operations/operation-types";

export function useCashierReceipt({
  deviceId,
  deviceToken,
  eventId,
  setMessage,
}: {
  deviceId: string;
  deviceToken: string;
  eventId: string;
  setMessage: (message: string | null) => void;
}) {
  const [receipt, setReceipt] = useState<TicketReceipt | null>(null);
  const [qrScanOpen, setQrScanOpen] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const printDocumentRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);
  const clear = useCallback(() => setReceipt(null), []);
  const openQrScan = useCallback(() => setQrScanOpen(true), []);
  const closeQrScan = useCallback(() => setQrScanOpen(false), []);

  async function prepareTicket(data: TicketGroupPrintData): Promise<TicketReceipt> {
    const startedAt = performance.now();
    const statusUrl = `${window.location.origin}/gruppe/${encodeURIComponent(data.code)}`;
    const ticket = {
      code: data.code,
      statusUrl,
      qrDataUrl: await QRCode.toDataURL(statusUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 768,
      }),
      eventName: data.eventName,
      productName: data.productName,
      gateLabel: data.gateLabel,
      communicationLabel: data.communicationLabel,
      groupSize: data.groupSize,
    };
    try {
      performance.measure("rundflug:cashier-sale-qr", {
        start: startedAt,
        end: performance.now(),
      });
    } catch {
      // Performance measurement must never affect a confirmed sale.
    }
    return ticket;
  }

  function beginRequest() {
    requestRef.current += 1;
    return requestRef.current;
  }

  function isCurrentRequest(requestToken: number) {
    return requestToken === requestRef.current;
  }

  async function reopen(
    ticketGroupId: string,
    confirmedPrintData?: TicketGroupPrintData,
    requestToken = beginRequest(),
  ): Promise<boolean> {
    try {
      const data =
        confirmedPrintData ??
        (await getTicketGroupPrintData(eventId, ticketGroupId, deviceId, deviceToken));
      const prepared = await prepareTicket(data);
      if (isCurrentRequest(requestToken)) setReceipt(prepared);
      return true;
    } catch (reason) {
      if (isCurrentRequest(requestToken)) {
        setReceipt(null);
        setMessage(
          reason instanceof Error ? reason.message : "Ticketzettel konnten nicht geladen werden.",
        );
      }
      return false;
    }
  }

  async function print(selectedTicketGroup: TicketSearchResult | undefined) {
    if (!receipt || selectedTicketGroup?.groupStatus === "CANCELED") {
      setMessage("Für diese Buchungsgruppe steht kein druckbares Ticketdokument bereit.");
      return;
    }
    const documentRoot = printDocumentRef.current;
    if (!documentRoot) {
      setMessage("Ticketdokument konnte nicht vorbereitet werden.");
      return;
    }
    setPrintBusy(true);
    try {
      const images = Array.from(documentRoot.querySelectorAll("img"));
      if (images.length !== 1) throw new Error("QR-Code ist noch nicht vollständig.");
      await Promise.all(
        images.map(async (image) => {
          if (!image.complete) {
            await new Promise<void>((resolve, reject) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => reject(new Error("QR-Code fehlt.")), {
                once: true,
              });
            });
          }
          if (image.naturalWidth === 0) throw new Error("QR-Code konnte nicht dargestellt werden.");
          await image.decode?.();
        }),
      );
      window.print();
      setMessage("Druckdialog geöffnet. Der Verkauf bleibt unabhängig vom Ausdruck gültig.");
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : "Ticketdokument konnte nicht gedruckt werden.",
      );
    } finally {
      setPrintBusy(false);
    }
  }

  return {
    beginRequest,
    clear,
    isCurrentRequest,
    openQrScan,
    closeQrScan,
    print,
    printBusy,
    printDocumentRef,
    qrScanOpen,
    receipt,
    reopen,
  };
}
