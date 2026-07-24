import { assessForecastFreshness } from "@rundflug/domain";
import type { Env } from "./types";
import { buildWebPushRequest } from "./web-push-request";

interface StoredPushSubscription {
  delivery_id: string;
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  target_kind: "TICKET" | "GROUP";
  ticket_public_code: string;
  group_public_code: string | null;
}

const DEFAULT_PUSH_RETENTION_DAYS = 7;
const PUSH_MESSAGES = {
  PREPARE_FOR_FLIGHT: "Bitte auf den bevorstehenden Aufruf vorbereiten.",
  FLIGHT_GROUP_CALLED: "Bitte jetzt zum Gate kommen.",
  ROTATION_STARTED: "Ihr Rundflug ist gestartet.",
  ROTATION_LANDED: "Ihr Rundflug ist gelandet.",
  ROTATION_COMPLETED: "Ihr Rundflug ist abgeschlossen.",
} as const;
export type PushNotificationType = keyof typeof PUSH_MESSAGES;

export function pushMessageFor(eventType: PushNotificationType): string {
  return PUSH_MESSAGES[eventType];
}

const PUBLIC_CODE_PATTERN = /^[A-Z2-9]{12,32}$/;

export function publicPushTargetPath(input: {
  targetKind: "TICKET" | "GROUP";
  ticketCode: string;
  groupCode: string | null;
}): string | null {
  const code = input.targetKind === "GROUP" ? input.groupCode : input.ticketCode;
  if (!code || !PUBLIC_CODE_PATTERN.test(code)) return null;
  return input.targetKind === "GROUP" ? `/gruppe/${code}` : `/ticket/${code}`;
}

export function shouldQueuePreparationNotification(input: {
  emergencyMode: boolean;
  interrupted: boolean;
  status: string;
  predictionQuality: string | null;
  predictionUpdatedAt: string | null;
  predictionUpperMinutes: number | null;
  notificationLeadMinutes: number;
  now: string;
}): boolean {
  const predictionQuality =
    input.predictionQuality === "STABLE" || input.predictionQuality === "CHANGING"
      ? input.predictionQuality
      : input.predictionQuality === "UNCERTAIN"
        ? "UNCERTAIN"
        : null;
  const freshness = assessForecastFreshness({
    predictionQuality,
    predictionUpdatedAt: input.predictionUpdatedAt,
    now: input.now,
  });
  return (
    !input.emergencyMode &&
    !input.interrupted &&
    input.status === "DRAFT" &&
    freshness.quality !== "UNCERTAIN" &&
    input.predictionUpperMinutes !== null &&
    input.predictionUpperMinutes <= input.notificationLeadMinutes
  );
}

export function pushRetentionDays(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 30
    ? parsed
    : DEFAULT_PUSH_RETENTION_DAYS;
}

export function pushDeleteAfter(operationsEndAt: string, retentionDays: number): string {
  const operationsEnd = Date.parse(operationsEndAt);
  if (!Number.isFinite(operationsEnd)) {
    throw new Error("Veranstaltungsende für Push-Aufbewahrung ist ungültig.");
  }
  return new Date(operationsEnd + retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

const PUSH_ENDPOINT_SUFFIXES = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
] as const;

export function isAllowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      PUSH_ENDPOINT_SUFFIXES.some(
        (suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`),
      )
    );
  } catch {
    return false;
  }
}

export async function sendRotationPushNotifications(
  env: Env,
  rotationId: string,
  eventType: PushNotificationType,
): Promise<number> {
  const now = new Date().toISOString();
  const queued = await env.DB.prepare(
    `INSERT INTO web_push_deliveries
       (id, operation_day_id, subscription_id, rotation_id, notification_type, status, queued_at)
     SELECT lower(hex(randomblob(16))), w.operation_day_id, w.id, ?1, ?2, 'PENDING', ?3
       FROM web_push_subscriptions w
      WHERE w.status = 'ACTIVE' AND w.delete_after > ?3
        AND (
          EXISTS (
            SELECT 1 FROM rotation_tickets direct_rt
             WHERE direct_rt.ticket_id = w.ticket_id
               AND direct_rt.released_at IS NULL
               AND direct_rt.rotation_id = ?1
          )
          OR (
            w.ticket_group_id IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM tickets group_ticket
                JOIN rotation_tickets group_rt
                  ON group_rt.ticket_id = group_ticket.id
                 AND group_rt.released_at IS NULL
               WHERE group_ticket.ticket_group_id = w.ticket_group_id
                 AND group_rt.rotation_id = ?1
            )
          )
        )
     ON CONFLICT(subscription_id, rotation_id, notification_type) DO NOTHING`,
  )
    .bind(rotationId, eventType, now)
    .run();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT)
    return queued.meta.changes;
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  const subscriptions = await env.DB.prepare(
    `SELECT d.id AS delivery_id, w.id, w.endpoint, w.p256dh, w.auth, w.target_kind,
            t.public_code AS ticket_public_code,
            tg.public_status_code AS group_public_code
       FROM web_push_deliveries d
       JOIN web_push_subscriptions w ON w.id = d.subscription_id
       JOIN tickets t ON t.id = w.ticket_id
       LEFT JOIN ticket_groups tg ON tg.id = w.ticket_group_id
      WHERE d.rotation_id = ?1 AND d.notification_type = ?2 AND d.status = 'PENDING'
        AND w.status = 'ACTIVE' AND w.delete_after > ?3
        AND (
          (w.target_kind = 'TICKET' AND t.public_code IS NOT NULL)
          OR (w.target_kind = 'GROUP' AND tg.public_status_code IS NOT NULL)
        )`,
  )
    .bind(rotationId, eventType, now)
    .all<StoredPushSubscription>();
  const messageBody = pushMessageFor(eventType);
  await Promise.allSettled(
    subscriptions.results.map(async (subscription) => {
      const targetPath = publicPushTargetPath({
        targetKind: subscription.target_kind,
        ticketCode: subscription.ticket_public_code,
        groupCode: subscription.group_public_code,
      });
      if (!targetPath) return;
      const payload = await buildWebPushRequest({
        data: JSON.stringify({
          title: "Rundflug-Leitstand",
          body: messageBody,
          url: targetPath,
        }),
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        ttl: 300,
        vapid,
      });
      const requestBody = new ArrayBuffer(payload.body.byteLength);
      new Uint8Array(requestBody).set(payload.body);
      const headers = new Headers();
      for (const [name, value] of Object.entries(payload.headers)) {
        if (value !== undefined) headers.set(name, value);
      }
      const response = await fetch(subscription.endpoint, {
        method: payload.method,
        headers,
        body: requestBody,
      });
      if (response.status === 404 || response.status === 410) {
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE web_push_subscriptions SET status = 'EXPIRED', updated_at = ?1 WHERE id = ?2",
          ).bind(new Date().toISOString(), subscription.id),
          env.DB.prepare(
            "UPDATE web_push_deliveries SET status = 'EXPIRED', last_attempt_at = ?1 WHERE id = ?2",
          ).bind(new Date().toISOString(), subscription.delivery_id),
        ]);
      } else if (response.ok) {
        await env.DB.prepare(
          `UPDATE web_push_deliveries SET status = 'DELIVERED', last_attempt_at = ?1,
             delivered_at = ?1 WHERE id = ?2`,
        )
          .bind(new Date().toISOString(), subscription.delivery_id)
          .run();
      } else {
        await env.DB.prepare("UPDATE web_push_deliveries SET last_attempt_at = ?1 WHERE id = ?2")
          .bind(new Date().toISOString(), subscription.delivery_id)
          .run();
      }
    }),
  );
  return queued.meta.changes;
}

export async function queueEligiblePreparationNotifications(
  env: Env,
  operationDayId: string,
  rotationId?: string,
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT r.id, r.status, r.prediction_quality, r.prediction_upper_minutes,
            r.prediction_updated_at,
            od.notification_lead_minutes, od.operational_interrupted, od.emergency_mode
       FROM rotations r
       JOIN operation_days od ON od.id = r.operation_day_id
      WHERE r.operation_day_id = ?1 AND (?2 IS NULL OR r.id = ?2)`,
  )
    .bind(operationDayId, rotationId ?? null)
    .all<{
      id: string;
      status: string;
      prediction_quality: string | null;
      prediction_upper_minutes: number | null;
      prediction_updated_at: string | null;
      notification_lead_minutes: number;
      operational_interrupted: number;
      emergency_mode: number;
    }>();
  const now = new Date().toISOString();
  const eligible = rows.results.filter((row) =>
    shouldQueuePreparationNotification({
      emergencyMode: row.emergency_mode === 1,
      interrupted: row.operational_interrupted === 1,
      status: row.status,
      predictionQuality: row.prediction_quality,
      predictionUpdatedAt: row.prediction_updated_at,
      predictionUpperMinutes: row.prediction_upper_minutes,
      notificationLeadMinutes: row.notification_lead_minutes,
      now,
    }),
  );
  const queued = await Promise.all(
    eligible.map((row) => sendRotationPushNotifications(env, row.id, "PREPARE_FOR_FLIGHT")),
  );
  return queued.reduce((sum, count) => sum + count, 0);
}

export async function purgeExpiredPushSubscriptions(env: Env, now = new Date()): Promise<number> {
  const result = await env.DB.prepare(
    "DELETE FROM web_push_subscriptions WHERE delete_after <= ?1 OR status <> 'ACTIVE'",
  )
    .bind(now.toISOString())
    .run();
  return result.meta.changes;
}
