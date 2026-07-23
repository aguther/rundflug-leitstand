export const fidsOperatorRoles = ["DISPLAY", "ADMIN"] as const;

export function mayAccessFids(role: string | null | undefined): boolean {
  return fidsOperatorRoles.some((allowedRole) => allowedRole === role);
}
