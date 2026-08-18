const DEFAULT_MAX_ATTEMPTS = 12;
const DEFAULT_REQUIRED_CONSECUTIVE_MATCHES = 2;

function defaultDelayForAttempt(attempt) {
  return Math.min(1_000 * 2 ** (attempt - 1), 10_000);
}

function sleep(delayMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

function revisionCheckUrl(baseUrl, expectedRevision, attempt) {
  const url = new URL("/api/meta", `${baseUrl.replace(/\/$/, "")}/`);
  url.searchParams.set("deployment-verification", `${expectedRevision}-${attempt}`);
  return url;
}

function describeError(error) {
  if (error instanceof Error) return String(error);
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}

export async function waitForExpectedRevision({
  baseUrl,
  expectedRevision,
  fetchImplementation = fetch,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  requiredConsecutiveMatches = DEFAULT_REQUIRED_CONSECUTIVE_MATCHES,
  delayForAttempt = defaultDelayForAttempt,
  sleepImplementation = sleep,
  onRetry = () => {},
}) {
  let consecutiveMatches = 0;
  let lastObservedRevision = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastError = null;
    try {
      const response = await fetchImplementation(
        revisionCheckUrl(baseUrl, expectedRevision, attempt),
        { headers: { "cache-control": "no-store" } },
      );
      if (!response.ok) throw new Error(`/api/meta returned HTTP ${response.status}.`);
      const metadata = await response.json();
      lastObservedRevision = metadata.sourceRevision ?? null;
      consecutiveMatches = lastObservedRevision === expectedRevision ? consecutiveMatches + 1 : 0;
      if (consecutiveMatches >= requiredConsecutiveMatches) return metadata;
    } catch (error) {
      consecutiveMatches = 0;
      lastError = error;
    }

    if (attempt === maxAttempts) break;
    const delayMs = delayForAttempt(attempt);
    onRetry({ attempt, delayMs, lastObservedRevision, error: lastError });
    await sleepImplementation(delayMs);
  }

  const observation = lastError
    ? ` Last request failed: ${describeError(lastError)}`
    : ` Last observed revision: ${lastObservedRevision ?? "unknown"}.`;
  throw new Error(
    `/api/meta did not stably report expected revision ${expectedRevision} after ${maxAttempts} attempts.${observation}`,
  );
}
