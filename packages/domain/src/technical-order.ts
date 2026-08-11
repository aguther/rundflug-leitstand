/**
 * Compares persisted technical identifiers by UTF-16 code unit.
 *
 * Unlike locale-aware display sorting, this order is deterministic across
 * runtimes and does not depend on the host's ICU data or default locale.
 */
export function compareTechnicalStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
