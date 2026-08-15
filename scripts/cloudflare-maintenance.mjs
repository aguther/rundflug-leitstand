const RELEASE_STAMP_PATTERN = /(?:^|\.)(20\d{6})(?:\.|$)/;

function releaseStamp(version, label) {
  const match = version?.match(RELEASE_STAMP_PATTERN);
  if (!match) throw new Error(`${label} enthält keinen Cloudflare-Releasestempel.`);
  return match[1];
}

function parseUtcDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    throw new Error(`${label} muss als YYYY-MM-DD angegeben sein.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} ist kein gültiges Datum.`);
  return date;
}

export function compatibilityDateAge(compatibilityDate, now = new Date()) {
  const configured = parseUtcDate(compatibilityDate, "compatibility_date");
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.floor((today.valueOf() - configured.valueOf()) / 86_400_000);
}

export function verifyCloudflareConfiguration(config, options = {}) {
  const ageDays = compatibilityDateAge(config.compatibility_date, options.now);
  if (ageDays < 0) throw new Error("compatibility_date darf nicht in der Zukunft liegen.");
  if (options.enforceCompatibilityAge && ageDays > 45) {
    throw new Error(
      `compatibility_date ist ${ageDays} Tage alt und überschreitet das 45-Tage-Limit.`,
    );
  }
  if (!config.compatibility_flags?.includes("nodejs_compat")) {
    throw new Error("nodejs_compat muss aktiviert bleiben.");
  }
  const observability = config.observability;
  if (
    observability?.enabled !== true ||
    observability.logs?.enabled !== true ||
    observability.logs?.persist !== true ||
    observability.traces?.enabled !== true ||
    observability.traces?.persist !== true
  ) {
    throw new Error("Persistierte Logs und Traces müssen explizit aktiviert sein.");
  }
  for (const [label, rate] of [
    ["logs", observability.logs.head_sampling_rate],
    ["traces", observability.traces.head_sampling_rate],
  ]) {
    if (typeof rate !== "number" || rate <= 0 || rate > 1) {
      throw new Error(`Die ${label}-Samplingrate muss größer 0 und höchstens 1 sein.`);
    }
  }
  return { compatibilityDate: config.compatibility_date, ageDays };
}

export function verifyCloudflareToolchain(packageJson, packageLock, generatedTypes) {
  const packages = packageLock.packages ?? {};
  const declared = packageJson.devDependencies ?? {};
  const installedWrangler = packages["node_modules/wrangler"];
  const installedWorkerd = packages["node_modules/workerd"];
  const installedWorkersTypes = packages["node_modules/@cloudflare/workers-types"];
  const installedPool = packages["node_modules/@cloudflare/vitest-pool-workers"];
  for (const [label, value] of [
    ["Wrangler", installedWrangler],
    ["workerd", installedWorkerd],
    ["Worker-Typen", installedWorkersTypes],
    ["Vitest-Worker-Pool", installedPool],
  ]) {
    if (!value?.version) throw new Error(`${label} fehlt im Lockfile.`);
  }
  if (declared.wrangler !== installedWrangler.version) {
    throw new Error("Wrangler muss exakt auf den Lockfile-Stand gepinnt sein.");
  }
  if (declared["@cloudflare/workers-types"] !== installedWorkersTypes.version) {
    throw new Error("Worker-Typen müssen exakt auf den Lockfile-Stand gepinnt sein.");
  }
  if (installedWrangler.dependencies?.workerd !== installedWorkerd.version) {
    throw new Error("Wrangler und workerd sind im Lockfile nicht aufeinander abgestimmt.");
  }
  if (installedPool.dependencies?.wrangler !== installedWrangler.version) {
    throw new Error("Worker-Testpool und Wrangler sind im Lockfile nicht aufeinander abgestimmt.");
  }
  const workerdStamp = releaseStamp(installedWorkerd.version, "workerd");
  const workersTypesStamp = releaseStamp(installedWorkersTypes.version, "Worker-Typen");
  if (workersTypesStamp < workerdStamp) {
    throw new Error("Die Worker-Typen sind älter als die verwendete workerd-Laufzeit.");
  }
  if (!generatedTypes.includes(`workerd@${installedWorkerd.version}`)) {
    throw new Error("Die generierten Bindings stammen nicht von der gesperrten workerd-Version.");
  }
  return {
    wrangler: installedWrangler.version,
    workerd: installedWorkerd.version,
    workersTypes: installedWorkersTypes.version,
    workerTestPool: installedPool.version,
  };
}

export function verifyGeneratedCompatibilityDate(generatedTypes, compatibilityDate) {
  if (
    !generatedTypes.match(new RegExp(String.raw`workerd@[^\s]+ ${compatibilityDate} nodejs_compat`))
  ) {
    throw new Error(
      "Die generierten Bindings verwenden nicht die konfigurierte Compatibility-Date.",
    );
  }
}
