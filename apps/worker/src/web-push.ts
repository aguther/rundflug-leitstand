import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { Env } from "./types";

interface StoredPushSubscription {
  delivery_id: string;
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const DEFAULT_PUSH_RETENTION_DAYS = 7;
const PUSH_MESSAGES = {
  PREPARE_FOR_FLIGHT: "Bitte auf den bevorstehenden Aufruf vorbereiten.",
  FLIGHT_GROUP_CALLED: "Bitte jetzt zur Flight Line kommen.",
  ROTATION_STARTED: "Ihr Rundflug hat begonnen.",
  ROTATION_LANDED: "Ihr Rundflug ist gelandet.",
  ROTATION_COMPLETED: "Ihr Rundflug ist abgeschlossen.",
} as const;
export type PushNotificationType = keyof typeof PUSH_MESSAGES;

export function shouldQueuePreparationNotification(input: {
  emergencyMode: boolean;
  interrupted: boolean;
  status: string;
  predictionQuality: string | null;
  predictionUpperMinutes: number | null;
  notificationLeadMinutes: number;
}): boolean {
  return (
    !input.emergencyMode &&
    !input.interrupted &&
    input.status === "DRAFT" &&
    input.predictionQuality !== "UNCERTAIN" &&
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
       JOIN rotation_tickets rt ON rt.ticket_id = w.ticket_id AND rt.released_at IS NULL
      WHERE rt.rotation_id = ?1 AND w.status = 'ACTIVE' AND w.delete_after > ?3
     ON CONFLICT(subscription_id, rotation_id, notification_type) DO NOTHING`,
  )
    .bind(rotationId, eventType, now)
    .run();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT)
    return queued.meta.changes;
  const subscriptions = await env.DB.prepare(
    `SELECT d.id AS delivery_id, w.id, w.endpoint, w.p256dh, w.auth
       FROM web_push_deliveries d
       JOIN web_push_subscriptions w ON w.id = d.subscription_id
      WHERE d.rotation_id = ?1 AND d.notification_type = ?2 AND d.status = 'PENDING'
        AND w.status = 'ACTIVE' AND w.delete_after > ?3`,
  )
    .bind(rotationId, eventType, now)
    .all<StoredPushSubscription>();
  const messageBody = PUSH_MESSAGES[eventType];
  await Promise.allSettled(
    subscriptions.results.map(async (subscription) => {
      const payload = await buildPushPayload(
        {
          data: JSON.stringify({ title: "Rundflug-Leitstand", body: messageBody, url: "/" }),
          options: { ttl: 300 },
        },
        {
          endpoint: subscription.endpoint,
          expirationTime: null,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        {
          subject: env.VAPID_SUBJECT,
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
        },
      );
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
      notification_lead_minutes: number;
      operational_interrupted: number;
      emergency_mode: number;
    }>();
  const eligible = rows.results.filter((row) =>
    shouldQueuePreparationNotification({
      emergencyMode: row.emergency_mode === 1,
      interrupted: row.operational_interrupted === 1,
      status: row.status,
      predictionQuality: row.prediction_quality,
      predictionUpperMinutes: row.prediction_upper_minutes,
      notificationLeadMinutes: row.notification_lead_minutes,
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
