import type { OperationBoard, TicketSearchResult } from "@rundflug/contracts";
import { Coins, Flag, Package, Sigma, Tickets, UserRound, Users } from "lucide-react";
import type { RefObject } from "react";
import { DataTable } from "../../design-system/components";
import { CashierCompletionIcon, TableIconHeader } from "./CashierTicketPresentation";
import {
  type TicketListTab,
  ticketListEmptyLabel,
  ticketListSentinelLabel,
} from "./CashierViewPresentation";

export function CashierTicketTable({
  board,
  currency,
  highlightedIds,
  lastTicketGroupId,
  loading,
  nextCursor,
  onOpenTicketGroup,
  rows,
  sentinelRef,
  tab,
}: Readonly<{
  board: OperationBoard | null;
  currency: (cents: number) => string;
  highlightedIds: ReadonlySet<string>;
  lastTicketGroupId: string | null;
  loading: boolean;
  nextCursor: string | null;
  onOpenTicketGroup: (result: TicketSearchResult) => void;
  rows: TicketSearchResult[];
  sentinelRef: RefObject<HTMLDivElement | null>;
  tab: TicketListTab;
}>) {
  return (
    <div className="cashier-ticket-table-wrap">
      <DataTable
        className="cashier-ticket-table"
        columns={[
          {
            key: "sold",
            header: (
              <TableIconHeader label="Verkauf">
                <Coins aria-hidden="true" size={17} />
              </TableIconHeader>
            ),
            render: (result) =>
              new Date(result.soldAt).toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
              }),
          },
          {
            key: "group",
            header: (
              <TableIconHeader label="Gruppe">
                <Tickets aria-hidden="true" size={17} />
              </TableIconHeader>
            ),
            render: (result) => result.bookingGroupLabel,
          },
          {
            key: "product",
            header: (
              <TableIconHeader label="Produkt">
                <Package aria-hidden="true" size={17} />
              </TableIconHeader>
            ),
            render: (result) => result.productName,
          },
          {
            key: "cashier",
            header: (
              <TableIconHeader label="Kasse">
                <UserRound aria-hidden="true" size={17} />
              </TableIconHeader>
            ),
            render: (result) => result.soldByOperatorLoginCode ?? "Nicht zugeordnet",
          },
          {
            key: "people",
            header: (
              <TableIconHeader label="Personen">
                <Users aria-hidden="true" size={17} />
              </TableIconHeader>
            ),
            render: (result) => result.groupSize,
          },
          {
            key: "completion",
            header: (
              <TableIconHeader label="Abgeschlossen">
                <Flag aria-hidden="true" size={17} />
              </TableIconHeader>
            ),
            align: "center",
            render: (result) => <CashierCompletionIcon result={result} />,
          },
          {
            key: "total",
            header: (
              <TableIconHeader label="Summe">
                <Sigma aria-hidden="true" size={17} />
              </TableIconHeader>
            ),
            align: "right",
            render: (result) =>
              currency(
                (board?.products.find((entry) => entry.id === result.productId)?.priceCents ?? 0) *
                  result.groupSize,
              ),
          },
        ]}
        emptyLabel={ticketListEmptyLabel(tab)}
        onRowClick={onOpenTicketGroup}
        rowKey={(result) => result.ticketGroupId}
        rowClassName={(result) =>
          highlightedIds.has(result.ticketGroupId) ? "cashier-ticket-row--new" : undefined
        }
        rows={rows}
        {...(lastTicketGroupId ? { selectedRowKey: lastTicketGroupId } : {})}
      />
      <div className="cashier-ticket-list-sentinel" ref={sentinelRef}>
        {ticketListSentinelLabel(loading, nextCursor)}
      </div>
    </div>
  );
}
