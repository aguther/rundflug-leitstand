export type AppDestination = {
  href: string;
  label: string;
  shortLabel?: string;
};

export const appDestinations: AppDestination[] = [
  { href: "/kasse", label: "Kasse" },
  { href: "/flight-line", label: "Flight Line", shortLabel: "Supervisor" },
  { href: "/flight-line/assist", label: "Assist" },
  { href: "/fids", label: "FIDS" },
  { href: "/admin", label: "Administration", shortLabel: "Admin" },
];

export function isDestinationActive(pathname: string, href: string): boolean {
  if (href === "/flight-line") return pathname === href;
  if (href === "/fids") return pathname === href || pathname.startsWith("/fids/");
  return pathname === href || pathname.startsWith(`${href}/`);
}
