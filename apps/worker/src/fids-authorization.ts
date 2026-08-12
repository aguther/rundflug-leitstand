export const fidsOperatorRoles: readonly string[] = ["DISPLAY", "ADMIN"];

export function mayAccessFids(role: string | null | undefined): boolean {
  return role !== null && role !== undefined && fidsOperatorRoles.includes(role);
}
