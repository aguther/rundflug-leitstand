/** Deterministic UTF-16 code-unit order for technical identifiers. */
export function compareTechnicalStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
