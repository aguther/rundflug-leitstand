import type { Hono } from "hono";
import type { SessionActor } from "./auth";
import { sha256Hex } from "./crypto";
import type { Env } from "./types";
import {
  isAllowedPushEndpoint,
  pushDeleteAfter,
  pushRetentionDays,
  queueEligiblePreparationNotifications,
  vapidConfiguration,
} from "./web-push";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

type UnknownTicketResponse = (env: Env, request: Request) => Promise<Response>;
type QueuePreparationNotifications = typeof queueEligiblePreparationNotifications;

interface PushSubscriptionBody {
  consent?: boolean;
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

interface TicketPushTarget {
  id: string;
  ticket_group_id: string;
  operation_day_id: string;
  operations_end_at: string | null;
  rotation_id: string;
}

interface GroupPushTarget {
  id: string;
  operation_day_id: string;
  operations_end_at: string | null;
  representative_ticket_id: string | null;
}

function validPushSubscription(body: PushSubscriptionBody): body is PushSubscriptionBody & {
  consent: true;
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  return (
    body.consent === true &&
    typeof body.endpoint === "string" &&
    isAllowedPushEndpoint(body.endpoint) &&
    typeof body.keys?.p256dh === "string" &&
    typeof body.keys.auth === "string"
  );
}

function invalidPushSubscriptionResponse() {
  return {
    error: { code: "INVALID_PUSH_SUBSCRIPTION", message: "Push-Einwilligung ist ungültig." },
  };
}

function pushRetentionError(operationsEndAt: string | null, retentionDays: number, now: Date) {
  if (!operationsEndAt) {
    return {
      response: {
        error: {
          code: "PUSH_RETENTION_UNCONFIGURED",
          message: "Web-Push ist erst nach Festlegung des Veranstaltungsendes verfügbar.",
        },
      },
      deleteAfter: null,
    } as const;
  }
  const deleteAfter = pushDeleteAfter(operationsEndAt, retentionDays);
  if (Date.parse(deleteAfter) <= now.getTime()) {
    return {
      response: {
        error: {
          code: "PUSH_RETENTION_EXPIRED",
          message: "Für diese Veranstaltung werden keine Push-Ziele mehr gespeichert.",
        },
      },
      deleteAfter,
    } as const;
  }
  return { response: null, deleteAfter } as const;
}

export function registerPublicPushRoutes(
  app: WorkerApp,
  unknownTicketResponse: UnknownTicketResponse,
  queuePreparationNotifications: QueuePreparationNotifications = queueEligiblePreparationNotifications,
) {
  app.get("/api/public/push/config", (context) => {
    const vapid = vapidConfiguration(context.env);
    if (!vapid) {
      return context.json(
        {
          error: { code: "PUSH_NOT_CONFIGURED", message: "Web-Push ist noch nicht eingerichtet." },
        },
        503,
      );
    }
    return context.json({
      publicKey: vapid.publicKey,
      retentionDays: pushRetentionDays(context.env.PUSH_RETENTION_DAYS),
    });
  });

  app.post("/api/public/push/subscriptions/refresh", async (context) => {
    const body = await context.req.json<{
      previousEndpoint?: string;
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    }>();
    if (
      typeof body.previousEndpoint !== "string" ||
      !isAllowedPushEndpoint(body.previousEndpoint) ||
      typeof body.endpoint !== "string" ||
      !isAllowedPushEndpoint(body.endpoint) ||
      typeof body.keys?.p256dh !== "string" ||
      typeof body.keys.auth !== "string"
    ) {
      return context.json(
        { error: { code: "INVALID_PUSH_SUBSCRIPTION", message: "Push-Erneuerung ist ungültig." } },
        400,
      );
    }
    const now = new Date().toISOString();
    const [, renewal] = await context.env.DB.batch([
      context.env.DB.prepare(
        "DELETE FROM web_push_subscriptions WHERE endpoint = ?1 AND endpoint <> ?2",
      ).bind(body.endpoint, body.previousEndpoint),
      context.env.DB.prepare(
        `UPDATE web_push_subscriptions
            SET endpoint = ?1, p256dh = ?2, auth = ?3, updated_at = ?4
          WHERE endpoint = ?5 AND status = 'ACTIVE' AND delete_after > ?4`,
      ).bind(body.endpoint, body.keys.p256dh, body.keys.auth, now, body.previousEndpoint),
    ]);
    if ((renewal?.meta.changes ?? 0) === 0) {
      return context.json(
        {
          error: {
            code: "PUSH_SUBSCRIPTION_NOT_FOUND",
            message: "Für dieses Push-Ziel liegt keine gültige Einwilligung vor.",
          },
        },
        404,
      );
    }
    return context.json({ active: true, updatedAt: now });
  });

  app.post("/api/public/tickets/:ticketCode/push-subscriptions", async (context) => {
    const ticketCode = context.req.param("ticketCode").trim().toUpperCase();
    if (!/^[A-Z2-9]{12,32}$/.test(ticketCode)) {
      return unknownTicketResponse(context.env, context.req.raw);
    }
    const body = await context.req.json<PushSubscriptionBody>();
    if (!validPushSubscription(body)) {
      return context.json(invalidPushSubscriptionResponse(), 400);
    }
    const ticket = await context.env.DB.prepare(
      `SELECT t.id, tg.id AS ticket_group_id, tg.operation_day_id,
              od.operations_end_at, rt.rotation_id FROM tickets t
         JOIN ticket_groups tg ON tg.id = t.ticket_group_id
         JOIN operation_days od ON od.id = tg.operation_day_id
         JOIN rotation_tickets rt ON rt.ticket_id = t.id AND rt.released_at IS NULL
        WHERE t.public_code_hash = ?1 AND t.status <> 'CANCELED'`,
    )
      .bind(await sha256Hex(ticketCode))
      .first<TicketPushTarget>();
    if (!ticket) {
      return unknownTicketResponse(context.env, context.req.raw);
    }
    const now = new Date();
    const retention = pushRetentionError(
      ticket.operations_end_at,
      pushRetentionDays(context.env.PUSH_RETENTION_DAYS),
      now,
    );
    if (retention.response) return context.json(retention.response, 409);

    await context.env.DB.prepare(
      `INSERT INTO web_push_subscriptions
         (id, operation_day_id, ticket_id, ticket_group_id, target_kind, endpoint, p256dh, auth,
          consented_at, delete_after, status, updated_at, origin)
       VALUES (?1, ?2, ?3, ?4, 'TICKET', ?5, ?6, ?7, ?8, ?9, 'ACTIVE', ?8, ?10)
       ON CONFLICT(endpoint) DO UPDATE SET ticket_id = excluded.ticket_id,
         ticket_group_id = excluded.ticket_group_id, operation_day_id = excluded.operation_day_id,
         target_kind = excluded.target_kind, p256dh = excluded.p256dh, auth = excluded.auth,
         consented_at = excluded.consented_at, delete_after = excluded.delete_after,
         origin = excluded.origin, status = 'ACTIVE', updated_at = excluded.updated_at`,
    )
      .bind(
        crypto.randomUUID(),
        ticket.operation_day_id,
        ticket.id,
        ticket.ticket_group_id,
        body.endpoint,
        body.keys.p256dh,
        body.keys.auth,
        now.toISOString(),
        retention.deleteAfter,
        new URL(context.req.url).origin,
      )
      .run();
    const preparationQueued = await queuePreparationNotifications(
      context.env,
      ticket.operation_day_id,
      ticket.rotation_id,
    );
    return context.json(
      {
        active: true,
        consentedAt: now.toISOString(),
        deleteAfter: retention.deleteAfter,
        preparationQueued: preparationQueued > 0,
      },
      201,
    );
  });

  app.post("/api/public/groups/:groupCode/push-subscriptions", async (context) => {
    const groupCode = context.req.param("groupCode").trim().toUpperCase();
    if (!/^[A-Z2-9]{12,32}$/.test(groupCode)) {
      return unknownTicketResponse(context.env, context.req.raw);
    }
    const body = await context.req.json<PushSubscriptionBody>();
    if (!validPushSubscription(body)) {
      return context.json(invalidPushSubscriptionResponse(), 400);
    }
    const group = await context.env.DB.prepare(
      `SELECT tg.id, tg.operation_day_id, od.operations_end_at,
              (SELECT t.id FROM tickets t WHERE t.ticket_group_id = tg.id
                ORDER BY t.created_at, t.id LIMIT 1) AS representative_ticket_id
         FROM ticket_groups tg
         JOIN operation_days od ON od.id = tg.operation_day_id
        WHERE tg.public_status_code_hash = ?1 AND tg.status <> 'CANCELED'`,
    )
      .bind(await sha256Hex(groupCode))
      .first<GroupPushTarget>();
    if (!group?.representative_ticket_id) {
      return unknownTicketResponse(context.env, context.req.raw);
    }
    const now = new Date();
    const retention = pushRetentionError(
      group.operations_end_at,
      pushRetentionDays(context.env.PUSH_RETENTION_DAYS),
      now,
    );
    if (retention.response) return context.json(retention.response, 409);

    await context.env.DB.prepare(
      `INSERT INTO web_push_subscriptions
         (id, operation_day_id, ticket_id, ticket_group_id, target_kind, endpoint, p256dh, auth,
          consented_at, delete_after, status, updated_at, origin)
       VALUES (?1, ?2, ?3, ?4, 'GROUP', ?5, ?6, ?7, ?8, ?9, 'ACTIVE', ?8, ?10)
       ON CONFLICT(endpoint) DO UPDATE SET ticket_id = excluded.ticket_id,
         ticket_group_id = excluded.ticket_group_id, operation_day_id = excluded.operation_day_id,
         target_kind = excluded.target_kind, p256dh = excluded.p256dh, auth = excluded.auth,
         consented_at = excluded.consented_at, delete_after = excluded.delete_after,
         origin = excluded.origin, status = 'ACTIVE', updated_at = excluded.updated_at`,
    )
      .bind(
        crypto.randomUUID(),
        group.operation_day_id,
        group.representative_ticket_id,
        group.id,
        body.endpoint,
        body.keys.p256dh,
        body.keys.auth,
        now.toISOString(),
        retention.deleteAfter,
        new URL(context.req.url).origin,
      )
      .run();
    const rotationRows = await context.env.DB.prepare(
      `SELECT DISTINCT rt.rotation_id
         FROM rotation_tickets rt
         JOIN tickets t ON t.id = rt.ticket_id
        WHERE t.ticket_group_id = ?1 AND rt.released_at IS NULL`,
    )
      .bind(group.id)
      .all<{ rotation_id: string }>();
    let preparationQueued = 0;
    for (const rotation of rotationRows.results) {
      preparationQueued += await queuePreparationNotifications(
        context.env,
        group.operation_day_id,
        rotation.rotation_id,
      );
    }
    return context.json(
      {
        active: true,
        consentedAt: now.toISOString(),
        deleteAfter: retention.deleteAfter,
        preparationQueued: preparationQueued > 0,
      },
      201,
    );
  });

  app.delete("/api/public/tickets/:ticketCode/push-subscriptions", async (context) => {
    const ticketCode = context.req.param("ticketCode").trim().toUpperCase();
    const body = await context.req.json<{ endpoint?: string }>();
    if (!/^[A-Z2-9]{12,32}$/.test(ticketCode) || typeof body.endpoint !== "string") {
      return context.json(
        { error: { code: "INVALID_REQUEST", message: "Abmeldung ist ungültig." } },
        400,
      );
    }
    await context.env.DB.prepare(
      `DELETE FROM web_push_subscriptions
        WHERE endpoint = ?1 AND target_kind = 'TICKET'
          AND ticket_id IN (SELECT id FROM tickets WHERE public_code_hash = ?2)`,
    )
      .bind(body.endpoint, await sha256Hex(ticketCode))
      .run();
    return context.body(null, 204);
  });

  app.delete("/api/public/groups/:groupCode/push-subscriptions", async (context) => {
    const groupCode = context.req.param("groupCode").trim().toUpperCase();
    const body = await context.req.json<{ endpoint?: string }>();
    if (!/^[A-Z2-9]{12,32}$/.test(groupCode) || typeof body.endpoint !== "string") {
      return context.json(
        { error: { code: "INVALID_REQUEST", message: "Abmeldung ist ungültig." } },
        400,
      );
    }
    await context.env.DB.prepare(
      `DELETE FROM web_push_subscriptions
        WHERE endpoint = ?1 AND target_kind = 'GROUP' AND ticket_group_id IN (
          SELECT id FROM ticket_groups WHERE public_status_code_hash = ?2
        )`,
    )
      .bind(body.endpoint, await sha256Hex(groupCode))
      .run();
    return context.body(null, 204);
  });
}
