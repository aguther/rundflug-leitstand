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
    href: "/flight-director",
    label: "Flight Director",
    roles: ["FLIGHT_DIRECTOR", "ADMIN"],
  },
  {
    href: "/flight-line",
    label: "Flight Line",
    roles: ["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"],
  },
  {
    href: "/fids",
    label: "FIDS",
    roles: ["DISPLAY", "ADMIN"],
  },
  { href: "/admin", label: "Administration", shortLabel: "Admin", roles: ["ADMIN"] },
];

export function destinationsForRole(role: OperatorRole): AppDestination[] {
  return appDestinations.filter((destination) => destination.roles.includes(role));
}

export function homeForRole(role: OperatorRole): string {
  const roleHomes: Record<OperatorRole, string> = {
    CASHIER: "/kasse",
    FLIGHT_LINE: "/flight-line",
    FLIGHT_DIRECTOR: "/flight-director",
    ADMIN: "/admin",
    DISPLAY: "/fids",
  };
  return roleHomes[role];
}

export function isDestinationActive(pathname: string, href: string): boolean {
  if (href === "/flight-director" || href === "/flight-line") return pathname === href;
  if (href === "/fids") return pathname === href || pathname.startsWith("/fids/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function mayOpenEventRoute(role: OperatorRole, pathname: string): boolean {
  if (pathname === "/simulation") return role === "ADMIN";
  return destinationsForRole(role).some((destination) =>
    isDestinationActive(pathname, destination.href),
  );
}
