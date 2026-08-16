import type { OperationBoard, TicketSearchResult } from "@rundflug/contracts";
import {
  Activity,
  CircleArrowRight,
  CircleCheck,
  Clock3,
  PlaneLanding,
  PlaneTakeoff,
  Printer,
  Tag,
  TicketsPlane,
  Trash2,
  Users,
} from "lucide-react";
import { Button, DataTable } from "../../design-system/components";
import type { TicketReceipt } from "../operations/operation-types";
import { TableIconHeader } from "./CashierTicketPresentation";
import {
  activeFlightEmptyLabel,
  CashierTicketGroupHeader,
  CashierTicketPaperPreview,
  goToGateIcon,
  rotationPhaseClass,
  rotationStatusLabel,
} from "./CashierViewPresentation";

type Rotation = OperationBoard["rotations"][number];

function rotationStatusIcon(rotation: Rotation) {
  const props = { "aria-hidden": true, size: 17 } as const;
  switch (rotation.status) {
    case "DRAFT":
      return <Clock3 {...props} />;
    case "CALLED":
      return <TicketsPlane {...props} />;
    case "IN_FLIGHT":
      return <PlaneTakeoff {...props} />;
    case "LANDED":
      return <PlaneLanding {...props} />;
    case "COMPLETED":
      return <CircleCheck {...props} />;
  }
}

export function CashierTicketDetails({
  cancelDisabled,
  onCancel,
  onEnlarge,
  onPrint,
  printBusy,
  receipt,
  rotations,
  rotationTimeWindow,
  selectedTicketGroup,
}: Readonly<{
  cancelDisabled: boolean;
  onCancel: () => void;
  onEnlarge: () => void;
  onPrint: () => void;
  printBusy: boolean;
  receipt: TicketReceipt | null;
  rotations: Rotation[];
  rotationTimeWindow: (rotation: Rotation) => string;
  selectedTicketGroup: TicketSearchResult | undefined;
}>) {
  return (
    <section className="cashier-ticket-detail">
      <CashierTicketGroupHeader group={selectedTicketGroup} />
      <div className="cashier-ticket-detail-grid">
        <div className="cashier-flight-groups">
          <DataTable
            columns={[
              {
                key: "flight-group",
                header: (
                  <TableIconHeader label="Fluggruppe">
                    <Tag aria-hidden="true" size={17} />
                  </TableIconHeader>
                ),
                render: (rotation) => rotation.communicationLabel,
              },
              {
                key: "people",
                header: (
                  <TableIconHeader label="Personen">
                    <Users aria-hidden="true" size={17} />
                  </TableIconHeader>
                ),
                align: "center",
                render: (rotation) =>
                  rotation.bookingGroups.find(
                    (group) => group.id === selectedTicketGroup?.ticketGroupId,
                  )?.ticketCount ?? 0,
              },
              {
                key: "status",
                header: (
                  <TableIconHeader label="Status">
                    <Activity aria-hidden="true" size={17} />
                  </TableIconHeader>
                ),
                align: "center",
                render: (rotation) => (
                  <span
                    className={rotationPhaseClass(rotation.status)}
                    role="img"
                    aria-label={rotationStatusLabel(rotation.status)}
                    title={rotationStatusLabel(rotation.status)}
                  >
                    {rotationStatusIcon(rotation)}
                  </span>
                ),
              },
              {
                key: "go-to-gate",
                header: (
                  <TableIconHeader label="GoToGate-Aktiv">
                    <CircleArrowRight aria-hidden="true" size={17} />
                  </TableIconHeader>
                ),
                align: "center",
                render: goToGateIcon,
              },
              {
                key: "time-window",
                header: (
                  <TableIconHeader label="Zeitfenster">
                    <Clock3 aria-hidden="true" size={17} />
                  </TableIconHeader>
                ),
                render: rotationTimeWindow,
              },
            ]}
            emptyLabel={activeFlightEmptyLabel(selectedTicketGroup)}
            rowKey={(rotation) => rotation.id}
            rows={rotations}
          />
        </div>
        <div className="cashier-ticket-paper">
          <CashierTicketPaperPreview receipt={receipt} onEnlarge={onEnlarge} />
        </div>
      </div>
      <div className="cashier-ticket-actions">
        <Button variant="danger" disabled={cancelDisabled} onClick={onCancel} type="button">
          <Trash2 aria-hidden="true" size={18} />
          Stornieren
        </Button>
        <Button
          disabled={!receipt || selectedTicketGroup?.groupStatus === "CANCELED"}
          busy={printBusy}
          onClick={onPrint}
          type="button"
        >
          <Printer aria-hidden="true" size={18} />
          Ticket drucken
        </Button>
      </div>
    </section>
  );
}
