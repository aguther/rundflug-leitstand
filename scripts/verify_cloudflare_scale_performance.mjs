import {
  assertCloudflareScaleTarget,
  CLOUDFLARE_SLO_MILLISECONDS,
  cloudflareScaleSlo,
  percentile95,
  serverTimingDuration,
} from "./scale-performance-policy.mjs";

const requiredEnvironment = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const targetOriginInput = requiredEnvironment("CLOUDFLARE_SCALE_TARGET_ORIGIN");
const eventId = requiredEnvironment("CLOUDFLARE_SCALE_EVENT_ID");
const confirmation = requiredEnvironment("CLOUDFLARE_SCALE_CONFIRMATION");
const sampleRounds = Number(process.env.CLOUDFLARE_SCALE_SAMPLE_ROUNDS ?? 3);
const connectedDevices = 20;
const requestTimeoutMilliseconds = 15_000;

if (!Number.isInteger(sampleRounds) || sampleRounds < 2 || sampleRounds > 10) {
  throw new Error("CLOUDFLARE_SCALE_SAMPLE_ROUNDS must be between 2 and 10.");
}

const candidateOrigin = new URL(targetOriginInput);
if (candidateOrigin.protocol !== "https:") {
  throw new Error("CLOUDFLARE_SCALE_TARGET_ORIGIN must use HTTPS.");
}

async function timedJson(path) {
  const startedAt = performance.now();
  const response = await fetch(new URL(path, candidateOrigin), {
    cache: "no-store",
    headers: { "cache-control": "no-store" },
    signal: AbortSignal.timeout(requestTimeoutMilliseconds),
  });
  const body = await response.json().catch(() => null);
  return { response, body, elapsedMs: performance.now() - startedAt };
}

function assertSuccessfulJson(result, label) {
  if (!result.response.ok || result.body === null) {
    throw new Error(`${label} failed with HTTP ${result.response.status}.`);
  }
}

function assertPublicBoard(body) {
  if (
    typeof body?.eventName !== "string" ||
    !Array.isArray(body.groups) ||
    body.groups.length !== 20 ||
    !Array.isArray(body.fleet)
  ) {
    throw new Error("The dedicated Cloudflare scale event has no complete public board fixture.");
  }
}

function connect() {
  return new Promise((resolvePromise, reject) => {
    const socketUrl = new URL(
      `/api/public/events/${encodeURIComponent(eventId)}/live`,
      candidateOrigin,
    );
    socketUrl.protocol = "wss:";
    const socket = new WebSocket(socketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("A Cloudflare WebSocket connection timed out."));
    }, requestTimeoutMilliseconds);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type !== "connected") return;
      clearTimeout(timeout);
      sockets.push(socket);
      resolvePromise(socket);
    });
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        socket.close();
        reject(new Error("A Cloudflare WebSocket connection failed."));
      },
      { once: true },
    );
  });
}

const sockets = [];
try {
  const health = await timedJson("/api/health");
  assertSuccessfulJson(health, "Cloudflare health check");
  const targetOrigin = assertCloudflareScaleTarget({
    confirmation,
    environment: health.body.environment,
    eventId,
    targetOrigin: targetOriginInput,
  });

  const boardPath = `/api/public/events/${encodeURIComponent(eventId)}/board`;
  const initial = await timedJson(boardPath);
  assertSuccessfulJson(initial, "Initial public board projection");
  assertPublicBoard(initial.body);
  const initialServerDuration = serverTimingDuration(
    initial.response.headers.get("server-timing"),
    "public-board",
  );
  if (initialServerDuration === null) {
    throw new Error("The public board projection returned no server timing.");
  }

  await Promise.all(Array.from({ length: connectedDevices }, () => connect()));

  const serverDurations = [];
  const clientDurations = [];
  for (let round = 0; round < sampleRounds; round += 1) {
    const results = await Promise.all(
      Array.from({ length: connectedDevices }, () => timedJson(boardPath)),
    );
    for (const result of results) {
      assertSuccessfulJson(result, "Parallel public board projection");
      assertPublicBoard(result.body);
      const serverDuration = serverTimingDuration(
        result.response.headers.get("server-timing"),
        "public-board",
      );
      if (serverDuration === null) {
        throw new Error("A public board projection returned no server timing.");
      }
      serverDurations.push(serverDuration);
      clientDurations.push(result.elapsedMs);
    }
  }

  const measurements = {
    initialPublicBoardServer: initialServerDuration,
    parallelPublicBoardServerP95: percentile95(serverDurations),
    parallelClientP95: percentile95(clientDurations),
  };
  const thresholds = cloudflareScaleSlo(measurements);
  if (Object.values(thresholds).some((passed) => !passed)) {
    throw new Error(
      `Cloudflare performance SLO exceeded: ${JSON.stringify({ measurements, thresholds })}`,
    );
  }

  console.log(
    JSON.stringify({
      ok: true,
      executionProfile: "cloudflare-acceptance-read-only",
      targetOrigin: targetOrigin.origin,
      eventId,
      requirements: ["Q-PER-020"],
      dataset: {
        connectedDevices,
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
    }),
  );
} finally {
  for (const socket of sockets) socket.close();
}
