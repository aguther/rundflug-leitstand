import {
  cloudflareScaleConfigFromEnvironment,
  runCloudflareScaleScenario,
} from "./lib/cloudflare-scale-scenario.mjs";

const config = cloudflareScaleConfigFromEnvironment();
const candidateOrigin = new URL(config.targetOrigin);

async function timedJson(path) {
  const startedAt = performance.now();
  const response = await fetch(new URL(path, candidateOrigin), {
    cache: "no-store",
    headers: { "cache-control": "no-store" },
    signal: AbortSignal.timeout(config.requestTimeoutMilliseconds),
  });
  const body = await response.json().catch(() => null);
  return { response, body, elapsedMs: performance.now() - startedAt };
}

function connect() {
  return new Promise((resolvePromise, reject) => {
    const socketUrl = new URL(
      `/api/public/events/${encodeURIComponent(config.eventId)}/live`,
      candidateOrigin,
    );
    socketUrl.protocol = "wss:";
    const socket = new WebSocket(socketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("A Cloudflare WebSocket connection timed out."));
    }, config.requestTimeoutMilliseconds);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type !== "connected") return;
      clearTimeout(timeout);
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

const report = await runCloudflareScaleScenario(config, {
  http: { timedJson },
  websocket: { close: (socket) => socket.close(), connect },
});
console.log(JSON.stringify(report));
