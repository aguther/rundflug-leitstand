const durationSeconds = Number(process.env.AVAILABILITY_DURATION_SECONDS ?? 12 * 60 * 60);
const intervalSeconds = Number(process.env.AVAILABILITY_INTERVAL_SECONDS ?? 60);
const timeoutSeconds = Number(process.env.AVAILABILITY_TIMEOUT_SECONDS ?? 10);
const requiredAvailabilityPercent = Number(process.env.AVAILABILITY_REQUIRED_PERCENT ?? 99.5);
const targetOrigin = new URL(
  process.env.AVAILABILITY_TARGET_ORIGIN ?? "https://rundflug-leitstand.andreas-7f3.workers.dev",
);

if (!Number.isFinite(durationSeconds) || durationSeconds < 20) {
  throw new Error("AVAILABILITY_DURATION_SECONDS muss mindestens 20 Sekunden betragen.");
}
if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > durationSeconds) {
  throw new Error("AVAILABILITY_INTERVAL_SECONDS muss zwischen 1 und der Laufzeit liegen.");
}
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > intervalSeconds) {
  throw new Error("AVAILABILITY_TIMEOUT_SECONDS muss zwischen 1 und dem Intervall liegen.");
}
if (
  !Number.isFinite(requiredAvailabilityPercent) ||
  requiredAvailabilityPercent < 0 ||
  requiredAvailabilityPercent > 100
) {
  throw new Error("AVAILABILITY_REQUIRED_PERCENT muss zwischen 0 und 100 liegen.");
}
if (targetOrigin.protocol !== "https:" && process.env.AVAILABILITY_ALLOW_HTTP !== "true") {
  throw new Error("Die zentrale Umgebung muss über HTTPS geprüft werden.");
}

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const probes = [
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
];

const probe = async ({ name, path, validate }) => {
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL(path, targetOrigin), {
      cache: "no-store",
      headers: { "cache-control": "no-store" },
      signal: AbortSignal.timeout(timeoutSeconds * 1_000),
    });
    const valid = response.ok && (await validate(response));
    return {
      name,
      available: valid,
      status: response.status,
      elapsedMilliseconds: performance.now() - startedAt,
      failure: valid ? null : "INVALID_RESPONSE",
    };
  } catch (error) {
    return {
      name,
      available: false,
      status: null,
      elapsedMilliseconds: performance.now() - startedAt,
      failure: error instanceof Error ? error.name : "REQUEST_FAILED",
    };
  }
};

const startedAt = Date.now();
const deadline = startedAt + durationSeconds * 1_000;
let intervals = 0;
let availableIntervals = 0;
let nextProbeAt = startedAt;
const failuresByProbe = Object.fromEntries(probes.map(({ name }) => [name, 0]));
const latencies = [];

while (Date.now() < deadline) {
  const results = await Promise.all(probes.map(probe));
  intervals += 1;
  const intervalAvailable = results.every(({ available }) => available);
  if (intervalAvailable) availableIntervals += 1;
  for (const result of results) {
    latencies.push(result.elapsedMilliseconds);
    if (!result.available) failuresByProbe[result.name] += 1;
  }
  if (!intervalAvailable || intervals === 1 || intervals % 60 === 0) {
    console.log(
      JSON.stringify({
        progress: true,
        intervals,
        availableIntervals,
        availabilityPercent: (availableIntervals / intervals) * 100,
        failedProbes: results
          .filter(({ available }) => !available)
          .map(({ name, status, failure }) => ({ name, status, failure })),
      }),
    );
  }
  nextProbeAt += intervalSeconds * 1_000;
  await sleep(Math.max(0, Math.min(nextProbeAt, deadline) - Date.now()));
}

const availabilityPercent = (availableIntervals / intervals) * 100;
const sortedLatencies = [...latencies].sort((left, right) => left - right);
const percentile = (fraction) =>
  sortedLatencies[Math.max(0, Math.ceil(sortedLatencies.length * fraction) - 1)] ?? 0;
const report = {
  success: availabilityPercent >= requiredAvailabilityPercent,
  targetOrigin: targetOrigin.origin,
  startedAt: new Date(startedAt).toISOString(),
  finishedAt: new Date().toISOString(),
  durationSeconds: (Date.now() - startedAt) / 1_000,
  intervalSeconds,
  timeoutSeconds,
  plannedMaintenanceExcluded: false,
  requiredAvailabilityPercent,
  availabilityPercent,
  intervals,
  availableIntervals,
  unavailableIntervals: intervals - availableIntervals,
  failuresByProbe,
  latencyMilliseconds: {
    median: percentile(0.5),
    p95: percentile(0.95),
    maximum: sortedLatencies.at(-1) ?? 0,
  },
};
console.log(JSON.stringify(report));

if (!report.success) {
  throw new Error(
    `Verfügbarkeit ${availabilityPercent.toFixed(3)} % unterschreitet ${requiredAvailabilityPercent.toFixed(3)} %.`,
  );
}
