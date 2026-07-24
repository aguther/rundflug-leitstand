import type { TicketSearchRequest } from "@rundflug/contracts";

export function ticketSearchStatusCondition(status: TicketSearchRequest["status"]): string {
  switch (status) {
    case "CANCELED":
      return "tg.status = 'CANCELED'";
    case "OPEN":
      return "tg.status NOT IN ('CANCELED', 'COMPLETED')";
    case "ACTIVE":
      return "tg.status <> 'CANCELED'";
  }
}
