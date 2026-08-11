/** Deterministic UTF-16 code-unit order for technical identifiers and paths. */
export function compareTechnicalStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
