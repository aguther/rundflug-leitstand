import { type CommandEnvelope, type CommandResult, commandResultSchema } from "@rundflug/contracts";
import type { DeviceRole } from "@rundflug/domain";
import { loadCommandPreflightReads } from "./command-preflight";
import type { ActiveOperatorClaimRow, CommandPreflightReads } from "./command-preflight-types";

const ASSIST_CLAIM_TTL_MS = 30 * 60_000;

export interface TrustedCommandPreflightContext {
  duplicateResult: CommandResult | null;
  reads: CommandPreflightReads;
  d1CallCount: 1;
}

interface TrustedCommandPreflightInput {
  command: CommandEnvelope;
  deviceRole: DeviceRole;
  operatorAccountId: string | null;
  now: Date;
}

interface ActiveClaimRenewalInput {
  command: CommandEnvelope;
  operatorAccountId: string;
  claim: ActiveOperatorClaimRow;
  now: Date;
}

export class CommandPreflightService {
  constructor(private readonly db: D1Database) {}

  logSlowReads(
    commandType: CommandEnvelope["type"],
    reads: CommandPreflightReads,
    trustedD1CallCount: number,
  ): void {
    if (reads.durationMs < 50) return;
    console.log(
      JSON.stringify({
        level: "info",
        code: "SLOW_COMMAND_PREFLIGHT",
        commandType,
        durationMs: Math.round(reads.durationMs),
        batchCount: reads.batchCount,
        statementCount: reads.statementCount,
        trustedD1CallCount: trustedD1CallCount || undefined,
      }),
    );
  }

  async loadTrusted({
    command,
    deviceRole,
    operatorAccountId,
    now,
  }: TrustedCommandPreflightInput): Promise<TrustedCommandPreflightContext> {
    const reads = await loadCommandPreflightReads({
      db: this.db,
      command,
      deviceRole,
      operatorAccountId,
      nowIso: now.toISOString(),
      includeIdempotencyReceipt: true,
    });
    const duplicateResult = reads.idempotencyResponseJson
      ? commandResultSchema.parse(JSON.parse(reads.idempotencyResponseJson))
      : null;
    return { duplicateResult, reads, d1CallCount: 1 };
  }

  async renewActiveClaim({
    command,
    operatorAccountId,
    claim,
    now,
  }: ActiveClaimRenewalInput): Promise<{ d1CallCount: 1 }> {
    await this.db
      .prepare(
        `UPDATE flight_line_assist_claims
            SET expires_at = ?1, revision = revision + 1
          WHERE operation_day_id = ?2 AND operator_account_id = ?3
            AND revision = ?4 AND expires_at > ?5`,
      )
      .bind(
        new Date(now.getTime() + ASSIST_CLAIM_TTL_MS).toISOString(),
        command.eventId,
        operatorAccountId,
        claim.revision,
        now.toISOString(),
      )
      .run();
    return { d1CallCount: 1 };
  }
}
