import type { OperationBoard, TicketSearchResult } from "@rundflug/contracts";
import { RefreshCw, Search } from "lucide-react";
import type { RefObject } from "react";
import { CheckboxField, IconButton, Panel, Tabs } from "../../design-system/components";
import type { LoginAccount } from "../auth/api";
import type { TicketReceipt } from "../operations/operation-types";
import { CashierTicketDetails } from "./CashierTicketDetails";
import { CashierTicketTable } from "./CashierTicketTable";
import type { TicketListTab } from "./CashierViewPresentation";

type Rotation = OperationBoard["rotations"][number];

export interface CashierTicketPanelProps {
  accounts: LoginAccount[];
  accountFilter: string;
  board: OperationBoard | null;
  currency: (cents: number) => string;
  highlightedIds: ReadonlySet<string>;
  lastTicketGroupId: string | null;
  loading: boolean;
  manualRefreshBusy: boolean;
  nextCursor: string | null;
  onlyOwnTickets: boolean;
  printBusy: boolean;
  receipt: TicketReceipt | null;
  rotations: Rotation[];
  rows: TicketSearchResult[];
  search: string;
  selectedTicketGroup: TicketSearchResult | undefined;
  sentinelRef: RefObject<HTMLDivElement | null>;
  sessionAvailable: boolean;
  tab: TicketListTab;
  onAccountFilterChange: (accountId: string) => void;
  onCancel: () => void;
  onEnlarge: () => void;
  onOnlyOwnTicketsChange: (checked: boolean) => void;
  onOpenTicketGroup: (result: TicketSearchResult) => void;
  onPrint: () => void;
  onRefresh: () => void;
  onRunSearch: () => void;
  onSearchChange: (search: string) => void;
  onTabChange: (tab: TicketListTab) => void;
  rotationTimeWindow: (rotation: Rotation) => string;
}

export function CashierTicketPanel(props: Readonly<CashierTicketPanelProps>) {
  return (
    <Panel className="cashier-ticket-panel" padding="none" aria-label="Verkaufte Tickets">
      <Tabs
        label="Ticketstatus"
        value={props.tab}
        onChange={props.onTabChange}
        items={[
          { value: "ACTIVE", label: "Verkaufte Tickets" },
          { value: "OPEN", label: "Offene Tickets" },
          { value: "CANCELED", label: "Stornierte Tickets" },
        ]}
      />
      <div className="ds-toolbar cashier-ticket-toolbar">
        <label className="ds-search-field">
          <Search aria-hidden="true" size={18} />
          <input
            aria-label="Tickets suchen"
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onRunSearch();
            }}
            placeholder="Suche (z. B. Gruppe, Produkt)"
          />
        </label>
        <label className="cashier-account-filter">
          <span>Kassenkonto</span>
          <select
            aria-label="Nach Kassenkonto filtern"
            disabled={props.onlyOwnTickets}
            onChange={(event) => props.onAccountFilterChange(event.target.value)}
            value={props.accountFilter}
          >
            <option value="">Alle Kassen</option>
            {props.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.loginCode}
              </option>
            ))}
          </select>
        </label>
        <CheckboxField
          checked={props.onlyOwnTickets}
          className="cashier-own-ticket-filter"
          disabled={!props.sessionAvailable}
          label="Nur meine Tickets"
          onChange={(event) => props.onOnlyOwnTicketsChange(event.target.checked)}
        />
        <IconButton
          label="Liste aktualisieren"
          busy={props.manualRefreshBusy}
          onClick={props.onRefresh}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={18} />
        </IconButton>
      </div>
      <CashierTicketTable
        board={props.board}
        currency={props.currency}
        highlightedIds={props.highlightedIds}
        lastTicketGroupId={props.lastTicketGroupId}
        loading={props.loading}
        nextCursor={props.nextCursor}
        onOpenTicketGroup={props.onOpenTicketGroup}
        rows={props.rows}
        sentinelRef={props.sentinelRef}
        tab={props.tab}
      />
      <CashierTicketDetails
        cancelDisabled={
          !props.lastTicketGroupId || props.selectedTicketGroup?.groupStatus === "CANCELED"
        }
        onCancel={props.onCancel}
        onEnlarge={props.onEnlarge}
        onPrint={props.onPrint}
        printBusy={props.printBusy}
        receipt={props.receipt}
        rotations={props.rotations}
        rotationTimeWindow={props.rotationTimeWindow}
        selectedTicketGroup={props.selectedTicketGroup}
      />
    </Panel>
  );
}
