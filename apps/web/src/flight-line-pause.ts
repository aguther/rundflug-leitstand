export function expectedReviewAtFromPause(
  minutes: 10 | 20 | 30 | null,
  now = Date.now(),
): string | null {
  if (minutes === null) return null;
  return new Date(now + minutes * 60_000).toISOString();
}
