import {
  assertAvailabilityReport,
  availabilityConfigFromEnvironment,
  availabilityProbes,
  probeAvailabilityEndpoint,
  runAvailabilityScenario,
} from "./lib/availability-harness.mjs";

const config = availabilityConfigFromEnvironment();
const report = await runAvailabilityScenario(config, {
  now: Date.now,
  onProgress: (progress) => console.log(JSON.stringify(progress)),
  probe: (input) =>
    probeAvailabilityEndpoint(input, {
      fetch,
      performanceNow: () => performance.now(),
      timeoutSignal: AbortSignal.timeout,
    }),
  probes: availabilityProbes,
  sleep: (milliseconds) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
});
console.log(JSON.stringify(report));
assertAvailabilityReport(report);
