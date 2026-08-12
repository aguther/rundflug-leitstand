import { type AssistClaim, assistClaimMutationSchema } from "@rundflug/contracts";
import type { DeviceRole } from "@rundflug/domain";
import { assistClaimConflictCode } from "./assist-claim-conflict";
import type { Env } from "./types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;
const ASSIST_CLAIM_TTL_MS = 30 * 60_000;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export class AssistClaimService {
  constructor(
    private readonly env: Env,
    private readonly eventIdFromPath: (pathname: string) => string | null,
    private readonly broadcastBoardRefresh: (eventVersion: number, eventType: string) => void,
  ) {}

  async handleRequest(request: Request, url: URL): Promise<Response> {
    const eventId = this.eventIdFromPath(url.pathname);
    const segments = url.pathname.split("/").filter(Boolean);
    const claimIndex = segments.indexOf("assist-claims");
    const aircraftId = claimIndex >= 0 ? segments[claimIndex + 1] : null;
    const accountId = request.headers.get("x-operator-account-id");
    const loginCode = request.headers.get("x-operator-login-code");
    const deviceId = request.headers.get("x-operator-device-id");
    const role = request.headers.get("x-operator-role") as DeviceRole | null;
    if (!eventId || !aircraftId || !accountId || !loginCode || !deviceId || !role) {
      return json(
        { error: { code: "SESSION_NOT_AUTHORIZED", message: "Anmeldung erforderlich." } },
        { status: 401 },
      );
    }
    if (!["FLIGHT_LINE", "FLIGHT_DIRECTOR", "ADMIN"].includes(role)) {
      return json(
        { error: { code: "ROLE_NOT_AUTHORIZED", message: "Sitzung ist nicht berechtigt." } },
        { status: 403 },
      );
    }

    const aircraft = await this.env.DB.prepare(
      `SELECT a.id, od.version AS event_version
         FROM aircraft a
         JOIN resource_group_memberships membership ON membership.aircraft_id = a.id
         JOIN operation_days od ON od.id = membership.operation_day_id
        WHERE a.id = ?1 AND membership.operation_day_id = ?2
          AND membership.active_until IS NULL`,
    )
      .bind(aircraftId, eventId)
      .first<{ id: string; event_version: number }>();
    if (!aircraft) {
      return json(
        { error: { code: "AIRCRAFT_NOT_FOUND", message: "Flugzeug nicht gefunden." } },
        { status: 404 },
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + ASSIST_CLAIM_TTL_MS).toISOString();
    const current = await this.env.DB.prepare(
      `SELECT claim.operator_account_id, claim.claimed_at, claim.expires_at, claim.revision,
              account.login_code
         FROM flight_line_assist_claims claim
         JOIN operator_accounts account ON account.id = claim.operator_account_id
        WHERE claim.operation_day_id = ?1 AND claim.aircraft_id = ?2`,
    )
      .bind(eventId, aircraftId)
      .first<{
        operator_account_id: string;
        claimed_at: string;
        expires_at: string;
        revision: number;
        login_code: string;
      }>();
    const active =
      current?.expires_at && Date.parse(current.expires_at) > now.getTime() ? current : null;

    if (request.method === "DELETE") {
      if (active?.operator_account_id !== accountId) return new Response(null, { status: 204 });
      const nextRevision = active.revision + 1;
      const payload = {
        action: "RELEASED",
        aircraftId,
        ownerLoginCode: loginCode,
        revision: nextRevision,
      };
      await this.env.DB.batch([
        this.env.DB.prepare(
          `DELETE FROM flight_line_assist_claims
            WHERE operation_day_id = ?1 AND aircraft_id = ?2
              AND operator_account_id = ?3 AND revision = ?4`,
        ).bind(eventId, aircraftId, accountId, active.revision),
        this.env.DB.prepare(
          `INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
             aggregate_id, aggregate_version, payload_json)
           VALUES (?1, ?2, 'AIRCRAFT_ASSIST_CLAIM_RELEASED', ?3, ?4,
                   'AIRCRAFT', ?5, ?6, ?7)`,
        ).bind(
          crypto.randomUUID(),
          eventId,
          nowIso,
          deviceId,
          aircraftId,
          nextRevision,
          JSON.stringify(payload),
        ),
        this.env.DB.prepare(
          `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
           VALUES (?1, ?2, 'ASSIST_CLAIM_CHANGED', ?3, ?4)`,
        ).bind(crypto.randomUUID(), eventId, JSON.stringify(payload), nowIso),
      ]);
      this.broadcastBoardRefresh(aircraft.event_version, "AIRCRAFT_ASSIST_CLAIM_RELEASED");
      return new Response(null, { status: 204 });
    }

    const parsed = assistClaimMutationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return json(
        { error: { code: "INVALID_ASSIST_CLAIM", message: "Übernahmedaten sind ungültig." } },
        { status: 400 },
      );
    }

    if (active?.operator_account_id === accountId) {
      const revision = active.revision + 1;
      await this.env.DB.prepare(
        `UPDATE flight_line_assist_claims
            SET expires_at = ?1, revision = ?2
          WHERE operation_day_id = ?3 AND aircraft_id = ?4
            AND operator_account_id = ?5 AND revision = ?6`,
      )
        .bind(expiresAt, revision, eventId, aircraftId, accountId, active.revision)
        .run();
      const response: AssistClaim = {
        aircraftId,
        claimedByCurrentOperator: true,
        ownerLoginCode: loginCode,
        revision,
        claimedAt: active.claimed_at,
        expiresAt,
      };
      return json(response);
    }

    if (active) {
      const conflict = {
        aircraftId,
        claimedByCurrentOperator: false,
        ownerLoginCode: active.login_code,
        revision: active.revision,
        claimedAt: active.claimed_at,
        expiresAt: active.expires_at,
      } satisfies AssistClaim;
      if (parsed.data.action !== "TAKEOVER" || parsed.data.expectedRevision !== active.revision) {
        return json(
          {
            claim: conflict,
            error: {
              code: assistClaimConflictCode(parsed.data.action),
              message: `Dieses Flugzeug wird derzeit von ${active.login_code} betreut.`,
            },
          },
          { status: 409 },
        );
      }

      const revision = active.revision + 1;
      const payload = {
        action: "TAKEN_OVER",
        aircraftId,
        previousOwnerLoginCode: active.login_code,
        ownerLoginCode: loginCode,
        revision,
      };
      await this.env.DB.batch([
        this.env.DB.prepare(
          `UPDATE flight_line_assist_claims
              SET operator_account_id = ?1, claimed_at = ?2, expires_at = ?3, revision = ?4
            WHERE operation_day_id = ?5 AND aircraft_id = ?6 AND revision = ?7`,
        ).bind(accountId, nowIso, expiresAt, revision, eventId, aircraftId, active.revision),
        this.env.DB.prepare(
          `INSERT INTO operational_events
            (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
             aggregate_id, aggregate_version, payload_json)
           VALUES (?1, ?2, 'AIRCRAFT_ASSIST_CLAIM_TAKEN_OVER', ?3, ?4,
                   'AIRCRAFT', ?5, ?6, ?7)`,
        ).bind(
          crypto.randomUUID(),
          eventId,
          nowIso,
          deviceId,
          aircraftId,
          revision,
          JSON.stringify(payload),
        ),
        this.env.DB.prepare(
          `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
           VALUES (?1, ?2, 'ASSIST_CLAIM_CHANGED', ?3, ?4)`,
        ).bind(crypto.randomUUID(), eventId, JSON.stringify(payload), nowIso),
      ]);
      this.broadcastBoardRefresh(aircraft.event_version, "AIRCRAFT_ASSIST_CLAIM_TAKEN_OVER");
      return json({
        aircraftId,
        claimedByCurrentOperator: true,
        ownerLoginCode: loginCode,
        revision,
        claimedAt: nowIso,
        expiresAt,
      } satisfies AssistClaim);
    }

    const revision = (current?.revision ?? 0) + 1;
    const payload = {
      action: "ACQUIRED",
      aircraftId,
      ownerLoginCode: loginCode,
      revision,
    };
    await this.env.DB.batch([
      this.env.DB.prepare(
        `DELETE FROM flight_line_assist_claims
          WHERE operation_day_id = ?1 AND operator_account_id = ?2 AND expires_at <= ?3`,
      ).bind(eventId, accountId, nowIso),
      this.env.DB.prepare(
        `INSERT INTO flight_line_assist_claims
          (operation_day_id, aircraft_id, operator_account_id, claimed_at, expires_at, revision)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(operation_day_id, aircraft_id) DO UPDATE SET
           operator_account_id = excluded.operator_account_id,
           claimed_at = excluded.claimed_at,
           expires_at = excluded.expires_at,
           revision = excluded.revision
         WHERE flight_line_assist_claims.expires_at <= excluded.claimed_at`,
      ).bind(eventId, aircraftId, accountId, nowIso, expiresAt, revision),
      this.env.DB.prepare(
        `INSERT INTO operational_events
          (id, operation_day_id, event_type, occurred_at, device_id, aggregate_type,
           aggregate_id, aggregate_version, payload_json)
         VALUES (?1, ?2, 'AIRCRAFT_ASSIST_CLAIM_ACQUIRED', ?3, ?4,
                 'AIRCRAFT', ?5, ?6, ?7)`,
      ).bind(
        crypto.randomUUID(),
        eventId,
        nowIso,
        deviceId,
        aircraftId,
        revision,
        JSON.stringify(payload),
      ),
      this.env.DB.prepare(
        `INSERT INTO outbox (id, operation_day_id, topic, payload_json, created_at)
         VALUES (?1, ?2, 'ASSIST_CLAIM_CHANGED', ?3, ?4)`,
      ).bind(crypto.randomUUID(), eventId, JSON.stringify(payload), nowIso),
    ]);
    this.broadcastBoardRefresh(aircraft.event_version, "AIRCRAFT_ASSIST_CLAIM_ACQUIRED");
    return json({
      aircraftId,
      claimedByCurrentOperator: true,
      ownerLoginCode: loginCode,
      revision,
      claimedAt: nowIso,
      expiresAt,
    } satisfies AssistClaim);
  }
}
