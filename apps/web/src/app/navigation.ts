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
    shortLabel: "Flugleitung",
    roles: ["FLIGHT_DIRECTOR", "ADMIN"],
  },
  {
    href: "/flight-line/assist",
    label: "Assist",
    roles: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  },
  {
    href: "/fids",
    label: "FIDS",
    roles: ["DISPLAY"],
  },
  { href: "/admin", label: "Administration", shortLabel: "Admin", roles: ["ADMIN"] },
];

export function destinationsForRole(role: OperatorRole): AppDestination[] {
  return appDestinations.filter((destination) => destination.roles.includes(role));
}

export function homeForRole(role: OperatorRole): string {
  const roleHomes: Record<OperatorRole, string> = {
    CASHIER: "/kasse",
    FLIGHT_LINE: "/flight-line/assist",
    FLIGHT_DIRECTOR: "/flight-line",
    ADMIN: "/admin",
    DISPLAY: "/fids",
  };
  return roleHomes[role];
}

export function isDestinationActive(pathname: string, href: string): boolean {
  if (href === "/flight-line") return pathname === href;
  if (href === "/fids") return pathname === href || pathname.startsWith("/fids/");
  return pathname === href || pathname.startsWith(`${href}/`);
}
