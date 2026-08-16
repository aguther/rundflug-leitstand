export const SOAK_DEFAULTS = Object.freeze({
  durationSeconds: 12 * 60 * 60,
  intervalSeconds: 60,
  port: 8_797,
  requestTimeoutMilliseconds: 2_000,
});

export function soakConfigFromEnvironment(environment = process.env) {
  const config = {
    durationSeconds: Number(environment.SOAK_DURATION_SECONDS ?? SOAK_DEFAULTS.durationSeconds),
    intervalSeconds: Number(environment.SOAK_INTERVAL_SECONDS ?? SOAK_DEFAULTS.intervalSeconds),
    port: Number(environment.SOAK_PORT ?? SOAK_DEFAULTS.port),
  };
  if (!Number.isFinite(config.durationSeconds) || config.durationSeconds < 20)
    throw new Error("SOAK_DURATION_SECONDS muss mindestens 20 Sekunden betragen.");
  if (
    !Number.isFinite(config.intervalSeconds) ||
    config.intervalSeconds < 1 ||
    config.intervalSeconds > config.durationSeconds
  )
    throw new Error("SOAK_INTERVAL_SECONDS muss zwischen 1 und der Laufzeit liegen.");
  if (!Number.isInteger(config.port) || config.port < 1_024 || config.port > 55_000)
    throw new Error("SOAK_PORT muss eine freie Portnummer zwischen 1024 und 55000 sein.");
  return config;
}

export function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

export async function requestJson(input, adapters) {
  const startedAt = adapters.performanceNow();
  const response = await adapters.fetch(input.url, {
    ...input.init,
    signal: adapters.timeoutSignal(input.maximumMilliseconds),
  });
  const elapsedMilliseconds = adapters.performanceNow() - startedAt;
  const body = await response.json();
  if (!response.ok) {
    await adapters.sleep(100);
    const diagnosticSuffix = adapters.diagnostic() ? ` · ${adapters.diagnostic()}` : "";
    throw new Error(
      `Langlauf-Request ${response.status}: ${body?.error?.code ?? "UNKNOWN_ERROR"}${diagnosticSuffix}`,
    );
  }
  if (elapsedMilliseconds >= input.maximumMilliseconds)
    throw new Error(
      `Langlauf-Request überschritt ${input.maximumMilliseconds} ms: ${elapsedMilliseconds.toFixed(1)} ms`,
    );
  return { body, elapsedMilliseconds };
}

export async function runSoakReliabilityScenario(config, adapters) {
  const startedAt = adapters.now();
  const deadline = startedAt + config.durationSeconds * 1_000;
  const latencies = [];
  let cycles = 0;
  while (adapters.now() < deadline) {
    if (!adapters.process.isAlive())
      throw new Error("Worker-Prozess wurde während des Langlaufs beendet.");
    const cycleStartedAt = adapters.now();
    await adapters.realtime.ensureHealthy();
    const previousRealtimeStateChanges = adapters.realtime.stateChanges();
    const health = await adapters.http.health();
    const current = await adapters.http.board();
    const sale = await adapters.http.command(current.body.event.version, "SELL_TICKET_GROUP", {
      productId: "panorama-20",
      ticketCount: 1,
      standby: false,
      paymentStatus: "PAID",
      paymentMethod: "CASH",
      oversizeSplitAcknowledged: false,
    });
    const cancellation = await adapters.http.command(
      sale.body.event.version,
      "CANCEL_TICKET_GROUP",
      {
        ticketGroupId: sale.body.aggregate.id,
        reason: "Synthetischer Langlaufzyklus",
        adminPin: adapters.adminPin,
      },
    );
    const confirmed = await adapters.http.board();
    if (confirmed.body.event.version !== cancellation.body.event.version)
      throw new Error("Bestätigter Langlaufstand stimmt nicht mit der Kommando-Version überein.");
    latencies.push(
      health.elapsedMilliseconds,
      current.elapsedMilliseconds,
      sale.elapsedMilliseconds,
      cancellation.elapsedMilliseconds,
      confirmed.elapsedMilliseconds,
    );
    cycles += 1;
    await adapters.realtime.waitForStateChange(previousRealtimeStateChanges);
    if (cycles === 1 || cycles % 60 === 0)
      adapters.onProgress?.({
        progress: true,
        cycles,
        elapsedMinutes: Number(((adapters.now() - startedAt) / 60_000).toFixed(1)),
        p95Milliseconds: Number(percentile(latencies, 0.95).toFixed(1)),
        ...adapters.realtime.metrics(),
      });
    const remainingCycleDelay = config.intervalSeconds * 1_000 - (adapters.now() - cycleStartedAt);
    const remainingRunTime = deadline - adapters.now();
    if (remainingCycleDelay > 0 && remainingRunTime > 0)
      await adapters.sleep(Math.min(remainingCycleDelay, remainingRunTime));
  }
  if (cycles < 1) throw new Error("Langlauf hat keinen vollständigen Zyklus ausgeführt.");
  return {
    ok: true,
    requirement: "Q-ZUV-050",
    configuredDurationSeconds: config.durationSeconds,
    actualDurationSeconds: Number(((adapters.now() - startedAt) / 1_000).toFixed(1)),
    intervalSeconds: config.intervalSeconds,
    port: config.port,
    cycles,
    requests: latencies.length,
    medianMilliseconds: Number(percentile(latencies, 0.5).toFixed(1)),
    p95Milliseconds: Number(percentile(latencies, 0.95).toFixed(1)),
    maximumMilliseconds: Number(Math.max(...latencies).toFixed(1)),
    ...adapters.realtime.metrics(),
    workerRestarted: false,
    anonymousSyntheticDataOnly: true,
  };
}
