import type { OperatorRole } from "@rundflug/contracts";

export type AppDestination = {
  href: string;
  label: string;
  shortLabel?: string;
  roles: OperatorRole[];
};

export const appDestinations: AppDestination[] = [
  { href: "/kasse", label: "Kasse", roles: ["CASHIER", "ADMIN"] },
  {
    href: "/flight-line",
    label: "Flight Line",
    shortLabel: "Supervisor",
    roles: ["FLIGHT_LINE_LEAD", "FLIGHT_DIRECTOR", "ADMIN"],
  },
  {
    href: "/flight-line/assist",
    label: "Assist",
    roles: ["FLIGHT_LINE", "FLIGHT_LINE_LEAD", "FLIGHT_DIRECTOR", "ADMIN"],
  },
  { href: "/fids", label: "FIDS", roles: ["DISPLAY", "FLIGHT_DIRECTOR", "ADMIN"] },
  { href: "/admin", label: "Administration", shortLabel: "Admin", roles: ["ADMIN"] },
];

export function destinationsForRole(role: OperatorRole): AppDestination[] {
  return appDestinations.filter((destination) => destination.roles.includes(role));
}

export function homeForRole(role: OperatorRole): string {
  return destinationsForRole(role)[0]?.href ?? "/";
}

export function isDestinationActive(pathname: string, href: string): boolean {
  if (href === "/flight-line") return pathname === href;
  if (href === "/fids") return pathname === href || pathname.startsWith("/fids/");
  return pathname === href || pathname.startsWith(`${href}/`);
}
