export const AVAILABILITY_DEFAULTS = Object.freeze({
  durationSeconds: 12 * 60 * 60,
  intervalSeconds: 60,
  timeoutSeconds: 10,
  requiredAvailabilityPercent: 99.5,
  targetOrigin: "https://rundflug-leitstand.andreas-7f3.workers.dev",
});

function numericEnvironmentValue(environment, name, fallback) {
  return Number(environment[name] ?? fallback);
}

export function availabilityConfigFromEnvironment(environment = process.env) {
  const config = {
    durationSeconds: numericEnvironmentValue(
      environment,
      "AVAILABILITY_DURATION_SECONDS",
      AVAILABILITY_DEFAULTS.durationSeconds,
    ),
    intervalSeconds: numericEnvironmentValue(
      environment,
      "AVAILABILITY_INTERVAL_SECONDS",
      AVAILABILITY_DEFAULTS.intervalSeconds,
    ),
    timeoutSeconds: numericEnvironmentValue(
      environment,
      "AVAILABILITY_TIMEOUT_SECONDS",
      AVAILABILITY_DEFAULTS.timeoutSeconds,
    ),
    requiredAvailabilityPercent: numericEnvironmentValue(
      environment,
      "AVAILABILITY_REQUIRED_PERCENT",
      AVAILABILITY_DEFAULTS.requiredAvailabilityPercent,
    ),
    targetOrigin: new URL(
      environment.AVAILABILITY_TARGET_ORIGIN ?? AVAILABILITY_DEFAULTS.targetOrigin,
    ),
  };
  if (!Number.isFinite(config.durationSeconds) || config.durationSeconds < 20)
    throw new Error("AVAILABILITY_DURATION_SECONDS muss mindestens 20 Sekunden betragen.");
  if (
    !Number.isFinite(config.intervalSeconds) ||
    config.intervalSeconds < 1 ||
    config.intervalSeconds > config.durationSeconds
  )
    throw new Error("AVAILABILITY_INTERVAL_SECONDS muss zwischen 1 und der Laufzeit liegen.");
  if (
    !Number.isFinite(config.timeoutSeconds) ||
    config.timeoutSeconds < 1 ||
    config.timeoutSeconds > config.intervalSeconds
  )
    throw new Error("AVAILABILITY_TIMEOUT_SECONDS muss zwischen 1 und dem Intervall liegen.");
  if (
    !Number.isFinite(config.requiredAvailabilityPercent) ||
    config.requiredAvailabilityPercent < 0 ||
    config.requiredAvailabilityPercent > 100
  )
    throw new Error("AVAILABILITY_REQUIRED_PERCENT muss zwischen 0 und 100 liegen.");
  if (config.targetOrigin.protocol !== "https:" && environment.AVAILABILITY_ALLOW_HTTP !== "true")
    throw new Error("Die zentrale Umgebung muss über HTTPS geprüft werden.");
  return config;
}

export const availabilityProbes = Object.freeze([
  {
    name: "web-shell",
    path: "/",
    validate: async (response) => {
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.text();
      return contentType.includes("text/html") && body.includes("Rundflug-Leitstand");
    },
  },
  {
    name: "worker-health",
    path: "/api/health",
    validate: async (response) => {
      const body = await response.json();
      return body?.ok === true && body?.service === "Rundflug-Leitstand";
    },
  },
  {
    name: "d1-setup-status",
    path: "/api/setup/status",
    validate: async (response) => {
      const body = await response.json();
      return typeof body?.setupRequired === "boolean" && typeof body?.setupConfigured === "boolean";
    },
  },
]);

export async function probeAvailabilityEndpoint(input, adapters) {
  const startedAt = adapters.performanceNow();
  try {
    const response = await adapters.fetch(new URL(input.probe.path, input.targetOrigin), {
      cache: "no-store",
      headers: { "cache-control": "no-store" },
      signal: adapters.timeoutSignal(input.timeoutSeconds * 1_000),
    });
    const valid = response.ok && (await input.probe.validate(response));
    return {
      name: input.probe.name,
      available: valid,
      status: response.status,
      elapsedMilliseconds: adapters.performanceNow() - startedAt,
      failure: valid ? null : "INVALID_RESPONSE",
    };
  } catch (error) {
    return {
      name: input.probe.name,
      available: false,
      status: null,
      elapsedMilliseconds: adapters.performanceNow() - startedAt,
      failure: error instanceof Error ? error.name : "REQUEST_FAILED",
    };
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

export async function runAvailabilityScenario(config, adapters) {
  const startedAt = adapters.now();
  const deadline = startedAt + config.durationSeconds * 1_000;
  let intervals = 0;
  let availableIntervals = 0;
  let nextProbeAt = startedAt;
  const failuresByProbe = Object.fromEntries(adapters.probes.map(({ name }) => [name, 0]));
  const latencies = [];
  while (adapters.now() < deadline) {
    const results = await Promise.all(
      adapters.probes.map((probe) =>
        adapters.probe({
          probe,
          targetOrigin: config.targetOrigin,
          timeoutSeconds: config.timeoutSeconds,
        }),
      ),
    );
    intervals += 1;
    const intervalAvailable = results.every(({ available }) => available);
    if (intervalAvailable) availableIntervals += 1;
    for (const result of results) {
      latencies.push(result.elapsedMilliseconds);
      if (!result.available) failuresByProbe[result.name] += 1;
    }
    if (!intervalAvailable || intervals === 1 || intervals % 60 === 0) {
      adapters.onProgress?.({
        progress: true,
        intervals,
        availableIntervals,
        availabilityPercent: (availableIntervals / intervals) * 100,
        failedProbes: results
          .filter(({ available }) => !available)
          .map(({ name, status, failure }) => ({ name, status, failure })),
      });
    }
    nextProbeAt += config.intervalSeconds * 1_000;
    await adapters.sleep(Math.max(0, Math.min(nextProbeAt, deadline) - adapters.now()));
  }
  const availabilityPercent = intervals === 0 ? 0 : (availableIntervals / intervals) * 100;
  return {
    success: availabilityPercent >= config.requiredAvailabilityPercent,
    targetOrigin: config.targetOrigin.origin,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(adapters.now()).toISOString(),
    durationSeconds: (adapters.now() - startedAt) / 1_000,
    intervalSeconds: config.intervalSeconds,
    timeoutSeconds: config.timeoutSeconds,
    plannedMaintenanceExcluded: false,
    requiredAvailabilityPercent: config.requiredAvailabilityPercent,
    availabilityPercent,
    intervals,
    availableIntervals,
    unavailableIntervals: intervals - availableIntervals,
    failuresByProbe,
    latencyMilliseconds: {
      median: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      maximum: Math.max(0, ...latencies),
    },
  };
}

export function assertAvailabilityReport(report) {
  if (!report.success)
    throw new Error(
      `Verfügbarkeit ${report.availabilityPercent.toFixed(3)} % unterschreitet ${report.requiredAvailabilityPercent.toFixed(3)} %.`,
    );
}
