const TRANSIENT_PATTERNS = [
  /\b429\b/,
  /\b5\d\d\b/,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /EAI_AGAIN/i,
  /ETIMEDOUT/i,
  /fetch failed/i,
  /gateway timeout/i,
  /internal server error/i,
  /service unavailable/i,
  /socket hang up/i,
  /temporarily unavailable/i,
];

export function isTransientInfrastructureFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

export async function withInfrastructureRetry(
  action,
  {
    maximumAttempts = 3,
    baseDelayMs = 1_000,
    sleep = (delayMs) => new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs)),
    onRetry = () => {},
  } = {},
) {
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      if (attempt === maximumAttempts || !isTransientInfrastructureFailure(error)) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      onRetry({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw new Error("Infrastructure retry exhausted unexpectedly.");
}
