export const LOCAL_CI_GUARDRAIL_MILLISECONDS = 10_000;
export const CLOUDFLARE_SLO_MILLISECONDS = 2_000;

export function percentile95(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("At least one performance measurement is required.");
  }
  return [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1];
}

export function serverTimingDuration(headerValue, metricName) {
  for (const entry of (headerValue ?? "").split(",")) {
    const [rawName, ...parameters] = entry.trim().split(";");
    if (rawName !== metricName) continue;
    const durationParameter = parameters.find((parameter) => parameter.trim().startsWith("dur="));
    const duration = Number(durationParameter?.trim().slice(4));
    return Number.isFinite(duration) && duration >= 0 ? duration : null;
  }
  return null;
}

export function localScaleGuardrails(measurements, limit = LOCAL_CI_GUARDRAIL_MILLISECONDS) {
  return {
    initialOperationsWithinCiGuardrail: measurements.initialOperations < limit,
    parallelDeviceP95WithinCiGuardrail: measurements.parallelDeviceP95 < limit,
    historyWithinCiGuardrail: measurements.history < limit,
    cashierPaginationWithinCiGuardrail:
      measurements.cashierPageOne < limit && measurements.cashierPageTwo < limit,
    cashierRevalidationWithinCiGuardrail: measurements.cashierRevalidation < limit,
    saleWithinCiGuardrail: measurements.sale < limit,
    forecastWithinCiGuardrail: measurements.forecast < limit,
  };
}

export function cloudflareScaleSlo(measurements) {
  return {
    initialPublicBoardServerUnderTwoSeconds:
      measurements.initialPublicBoardServer < CLOUDFLARE_SLO_MILLISECONDS,
    parallelPublicBoardServerP95UnderTwoSeconds:
      measurements.parallelPublicBoardServerP95 < CLOUDFLARE_SLO_MILLISECONDS,
  };
}

export function assertCloudflareScaleTarget({ confirmation, environment, eventId, targetOrigin }) {
  if (confirmation !== "PERFORMANCE") {
    throw new Error("CLOUDFLARE_SCALE_CONFIRMATION must be PERFORMANCE.");
  }
  const origin = new URL(targetOrigin);
  if (origin.protocol !== "https:") {
    throw new Error("The Cloudflare scale target must use HTTPS.");
  }
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("The Cloudflare scale target must be an origin without credentials or a path.");
  }
  if (environment !== "acceptance") {
    throw new Error("The Cloudflare scale SLO may only run against an acceptance environment.");
  }
  if (!/^perf-[a-z0-9-]+$/.test(eventId)) {
    throw new Error("The Cloudflare scale event ID must start with perf-.");
  }
  return origin;
}
