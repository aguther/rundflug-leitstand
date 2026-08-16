import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

const full = process.argv.includes("--full");
const eventCount = 3;
const durationHours = full ? 72 : 48;
const rotationCount = full ? 300 : 30;
const runIntervalSeconds = 30;
const anchorIntervalRuns = 10;
const forecastSampleCount = 100;
const retainedRunIntervals = (24 * 60 * 60) / runIntervalSeconds;
const runCount = (durationHours * 60 * 60) / runIntervalSeconds;

function schema(database) {
  database.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE TABLE planning_runs (
      event_id TEXT NOT NULL,
      run_sequence INTEGER NOT NULL,
      capture_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (event_id, run_sequence)
    ) STRICT;
    CREATE TABLE forecast_snapshots (
      event_id TEXT NOT NULL,
      run_sequence INTEGER NOT NULL,
      rotation_sequence INTEGER NOT NULL,
      lower_minutes INTEGER NOT NULL,
      upper_minutes INTEGER NOT NULL,
      PRIMARY KEY (event_id, run_sequence, rotation_sequence),
      FOREIGN KEY (event_id, run_sequence)
        REFERENCES planning_runs(event_id, run_sequence) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX idx_scale_snapshots_event_run
      ON forecast_snapshots(event_id, rotation_sequence, run_sequence DESC);
  `);
}

function populateEvent(database, eventId, runs, rotations) {
  database
    .prepare(
      `WITH RECURSIVE sequence(value) AS (
         SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value + 1 < ?2
       )
       INSERT INTO planning_runs(event_id, run_sequence, capture_mode, status)
       SELECT ?1, value, CASE WHEN value % ?3 = 0 THEN 'ANCHOR' ELSE 'REFERENCE' END, 'SUCCEEDED'
         FROM sequence`,
    )
    .run(eventId, runs, anchorIntervalRuns);
  database
    .prepare(
      `WITH RECURSIVE
         runs(value) AS (SELECT 0 UNION ALL SELECT value + 1 FROM runs WHERE value + 1 < ?2),
         rotations(value) AS (
           SELECT 0 UNION ALL SELECT value + 1 FROM rotations WHERE value + 1 < ?3
         )
       INSERT INTO forecast_snapshots
         (event_id, run_sequence, rotation_sequence, lower_minutes, upper_minutes)
       SELECT ?1, runs.value, rotations.value, 5, 15 FROM runs CROSS JOIN rotations`,
    )
    .run(eventId, runs, rotations);
}

function populatedDatabase(runs = runCount) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  schema(database);
  database.exec("BEGIN");
  for (let event = 0; event < eventCount; event += 1) {
    populateEvent(database, `event-${event}`, runs, rotationCount);
  }
  database.exec("COMMIT");
  return database;
}

function percentile95(samples) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}

function forecastProbe(database, eventId) {
  const started = performance.now();
  const lookup = database.prepare(
    `SELECT run_sequence, lower_minutes, upper_minutes
       FROM forecast_snapshots
      WHERE event_id = ?1 AND rotation_sequence = ?2
      ORDER BY run_sequence DESC LIMIT 1`,
  );
  const snapshots = [];
  for (let rotation = 0; rotation < rotationCount; rotation += 1) {
    snapshots.push(lookup.get(eventId, rotation));
  }
  let forecastChecksum = 0;
  const scenarioCount = Math.ceil(1_500_000 / rotationCount);
  for (let scenario = 0; scenario < scenarioCount; scenario += 1) {
    let minuteCursor = scenario % 17;
    for (const snapshot of snapshots) {
      minuteCursor =
        Math.max(minuteCursor, Number(snapshot.run_sequence) % 1_440) +
        Number(snapshot.lower_minutes) +
        ((scenario + Number(snapshot.upper_minutes)) % 3);
      forecastChecksum = (forecastChecksum + minuteCursor) % 2_147_483_647;
    }
  }
  if (!Number.isFinite(forecastChecksum)) throw new Error("PLANNING_HISTORY_SCALE_PROBE_INVALID");
  return performance.now() - started;
}

function warmAndMeasure(database, eventId, samples) {
  for (let index = 0; index < 20; index += 1) forecastProbe(database, eventId);
  return Array.from({ length: samples }, () => forecastProbe(database, eventId));
}

function compactActiveEvent(database, eventId, duringSamples) {
  const cutoffSequence = runCount - 1 - retainedRunIntervals;
  const boundarySequence = Math.floor(cutoffSequence / anchorIntervalRuns) * anchorIntervalRuns;
  let deletedSnapshots = 0;
  for (;;) {
    const deleted = database
      .prepare(
        `DELETE FROM forecast_snapshots WHERE rowid IN (
           SELECT rowid FROM forecast_snapshots
            WHERE event_id = ?1 AND run_sequence < ?2 LIMIT 10000
         )`,
      )
      .run(eventId, boundarySequence).changes;
    deletedSnapshots += Number(deleted);
    if (deleted === 0) break;
    if (duringSamples.length < forecastSampleCount) {
      duringSamples.push(forecastProbe(database, "event-2"));
    }
  }
  let deletedRuns = 0;
  for (;;) {
    const deleted = database
      .prepare(
        `DELETE FROM planning_runs WHERE rowid IN (
           SELECT rowid FROM planning_runs
            WHERE event_id = ?1 AND run_sequence < ?2 ORDER BY run_sequence DESC LIMIT 500
         )`,
      )
      .run(eventId, boundarySequence).changes;
    deletedRuns += Number(deleted);
    if (deleted === 0) break;
  }
  return { boundarySequence, deletedRuns, deletedSnapshots };
}

function logicalCounts(database, eventId) {
  return {
    runs: Number(
      database
        .prepare("SELECT COUNT(*) AS count FROM planning_runs WHERE event_id = ?1")
        .get(eventId).count,
    ),
    snapshots: Number(
      database
        .prepare("SELECT COUNT(*) AS count FROM forecast_snapshots WHERE event_id = ?1")
        .get(eventId).count,
    ),
  };
}

const database = populatedDatabase();
try {
  const baselineSamples = warmAndMeasure(database, "event-2", forecastSampleCount);
  const duringSamples = [];
  const segments = [];
  for (let event = 0; event < eventCount; event += 1) {
    const result = compactActiveEvent(database, `event-${event}`, duringSamples);
    const counts = logicalCounts(database, `event-${event}`);
    const expectedRuns = runCount - result.boundarySequence;
    if (counts.runs !== expectedRuns || counts.snapshots !== expectedRuns * rotationCount) {
      throw new Error(`PLANNING_HISTORY_SCALE_HOT_WINDOW_INVALID:event-${event}`);
    }
    if (result.deletedRuns + counts.runs !== runCount) {
      throw new Error(`PLANNING_HISTORY_SCALE_RUN_GAP:event-${event}`);
    }
    if (result.deletedSnapshots + counts.snapshots !== runCount * rotationCount) {
      throw new Error(`PLANNING_HISTORY_SCALE_SNAPSHOT_GAP:event-${event}`);
    }
    segments.push({ eventId: `event-${event}`, ...result, hot: counts });
  }
  while (duringSamples.length < forecastSampleCount) {
    duringSamples.push(forecastProbe(database, "event-2"));
  }
  const baselineP95Ms = percentile95(baselineSamples);
  const compactionP95Ms = percentile95(duringSamples);
  const degradation = baselineP95Ms === 0 ? 0 : (compactionP95Ms - baselineP95Ms) / baselineP95Ms;
  if (compactionP95Ms >= 2_000 || degradation > 0.1) {
    throw new Error(
      `PLANNING_HISTORY_SCALE_FORECAST_BUDGET_EXCEEDED:${baselineP95Ms}:${compactionP95Ms}`,
    );
  }

  database.exec("VACUUM");
  const compactedPages = Number(database.prepare("PRAGMA page_count").get().page_count);
  const hotRuns = segments[0].hot.runs;
  const baselineDatabase = populatedDatabase(hotRuns);
  baselineDatabase.exec("VACUUM");
  const baselinePages = Number(baselineDatabase.prepare("PRAGMA page_count").get().page_count);
  baselineDatabase.close();
  if (compactedPages > baselinePages * 1.1) {
    throw new Error(
      `PLANNING_HISTORY_SCALE_PAGE_BUDGET_EXCEEDED:${compactedPages}:${baselinePages}`,
    );
  }

  for (let event = 0; event < eventCount; event += 1) {
    database.prepare("DELETE FROM forecast_snapshots WHERE event_id = ?1").run(`event-${event}`);
    database.prepare("DELETE FROM planning_runs WHERE event_id = ?1").run(`event-${event}`);
    const terminal = logicalCounts(database, `event-${event}`);
    if (terminal.runs !== 0 || terminal.snapshots !== 0) {
      throw new Error(`PLANNING_HISTORY_SCALE_TERMINAL_COMPACTION_INVALID:event-${event}`);
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      mode: full ? "full" : "ci",
      eventCount,
      durationHours,
      runIntervalSeconds,
      rotationCount,
      totalRuns: runCount * eventCount,
      totalSnapshots: runCount * rotationCount * eventCount,
      baselineP95Ms,
      compactionP95Ms,
      degradationPercent: degradation * 100,
      compactedPages,
      baselinePages,
      segments,
    })}\n`,
  );
} finally {
  database.close();
}
