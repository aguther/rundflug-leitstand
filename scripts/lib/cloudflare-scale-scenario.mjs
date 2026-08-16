import {
  assertCloudflareScaleTarget,
  CLOUDFLARE_SLO_MILLISECONDS,
  cloudflareScaleSlo,
  percentile95,
  serverTimingDuration,
} from "../scale-performance-policy.mjs";

function requiredEnvironment(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function cloudflareScaleConfigFromEnvironment(environment = process.env) {
  const config = {
    targetOrigin: requiredEnvironment(environment, "CLOUDFLARE_SCALE_TARGET_ORIGIN"),
    eventId: requiredEnvironment(environment, "CLOUDFLARE_SCALE_EVENT_ID"),
    confirmation: requiredEnvironment(environment, "CLOUDFLARE_SCALE_CONFIRMATION"),
    sampleRounds: Number(environment.CLOUDFLARE_SCALE_SAMPLE_ROUNDS ?? 3),
    connectedDevices: 20,
    requestTimeoutMilliseconds: 15_000,
  };
  if (!Number.isInteger(config.sampleRounds) || config.sampleRounds < 2 || config.sampleRounds > 10)
    throw new Error("CLOUDFLARE_SCALE_SAMPLE_ROUNDS must be between 2 and 10.");
  if (new URL(config.targetOrigin).protocol !== "https:")
    throw new Error("CLOUDFLARE_SCALE_TARGET_ORIGIN must use HTTPS.");
  return config;
}

function assertSuccessfulJson(result, label) {
  if (!result.response.ok || result.body === null)
    throw new Error(`${label} failed with HTTP ${result.response.status}.`);
}

function assertPublicBoard(body) {
  if (
    typeof body?.eventName !== "string" ||
    !Array.isArray(body.groups) ||
    body.groups.length !== 20 ||
    !Array.isArray(body.fleet)
  )
    throw new Error("The dedicated Cloudflare scale event has no complete public board fixture.");
}

function serverDuration(result, label) {
  const duration = serverTimingDuration(
    result.response.headers.get("server-timing"),
    "public-board",
  );
  if (duration === null) throw new Error(`${label} returned no server timing.`);
  return duration;
}

export async function runCloudflareScaleScenario(config, adapters) {
  const sockets = [];
  try {
    const health = await adapters.http.timedJson("/api/health");
    assertSuccessfulJson(health, "Cloudflare health check");
    const targetOrigin = assertCloudflareScaleTarget({
      confirmation: config.confirmation,
      environment: health.body.environment,
      eventId: config.eventId,
      targetOrigin: config.targetOrigin,
    });
    const boardPath = `/api/public/events/${encodeURIComponent(config.eventId)}/board`;
    const initial = await adapters.http.timedJson(boardPath);
    assertSuccessfulJson(initial, "Initial public board projection");
    assertPublicBoard(initial.body);
    const initialServerDuration = serverDuration(initial, "The public board projection");
    sockets.push(
      ...(await Promise.all(
        Array.from({ length: config.connectedDevices }, () => adapters.websocket.connect()),
      )),
    );
    const serverDurations = [];
    const clientDurations = [];
    for (let round = 0; round < config.sampleRounds; round += 1) {
      const results = await Promise.all(
        Array.from({ length: config.connectedDevices }, () => adapters.http.timedJson(boardPath)),
      );
      for (const result of results) {
        assertSuccessfulJson(result, "Parallel public board projection");
        assertPublicBoard(result.body);
        serverDurations.push(serverDuration(result, "A public board projection"));
        clientDurations.push(result.elapsedMs);
      }
    }
    const measurements = {
      initialPublicBoardServer: initialServerDuration,
      parallelPublicBoardServerP95: percentile95(serverDurations),
      parallelClientP95: percentile95(clientDurations),
    };
    const thresholds = cloudflareScaleSlo(measurements);
    if (Object.values(thresholds).some((passed) => !passed))
      throw new Error(
        `Cloudflare performance SLO exceeded: ${JSON.stringify({ measurements, thresholds })}`,
      );
    return {
      ok: true,
      executionProfile: "cloudflare-acceptance-read-only",
      targetOrigin: targetOrigin.origin,
      eventId: config.eventId,
      requirements: ["Q-PER-020"],
      dataset: {
        connectedDevices: config.connectedDevices,
        operationSamples: serverDurations.length,
        visibleGroups: initial.body.groups.length,
      },
      sloMilliseconds: CLOUDFLARE_SLO_MILLISECONDS,
      measurementsMs: {
        initialPublicBoardServer: Math.round(measurements.initialPublicBoardServer),
        parallelPublicBoardServerP95: Math.round(measurements.parallelPublicBoardServerP95),
        parallelPublicBoardClientP95: Math.round(measurements.parallelClientP95),
      },
      thresholds,
    };
  } finally {
    for (const socket of sockets) adapters.websocket.close(socket);
  }
}
