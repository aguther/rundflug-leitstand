export function expectedReviewAtFromPause(
  minutesInput: string,
  durationUnknown: boolean,
  now = Date.now(),
): string | null {
  const minutes = Number(minutesInput);
  if (durationUnknown || !Number.isFinite(minutes) || minutes <= 0) return null;
  return new Date(now + minutes * 60_000).toISOString();
}
