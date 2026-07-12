import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { Env } from "./types";

interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const DEFAULT_PUSH_RETENTION_DAYS = 7;

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
  eventType: string,
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return;
  const subscriptions = await env.DB.prepare(
    `SELECT DISTINCT w.id, w.endpoint, w.p256dh, w.auth
       FROM web_push_subscriptions w
       JOIN rotation_tickets rt ON rt.ticket_id = w.ticket_id AND rt.released_at IS NULL
      WHERE rt.rotation_id = ?1 AND w.status = 'ACTIVE' AND w.delete_after > ?2`,
  )
    .bind(rotationId, new Date().toISOString())
    .all<StoredPushSubscription>();
  const messages: Record<string, string> = {
    FLIGHT_GROUP_CALLED: "Bitte jetzt zur Flight Line kommen.",
    ROTATION_STARTED: "Ihr Rundflug hat begonnen.",
    ROTATION_LANDED: "Ihr Rundflug ist gelandet.",
    ROTATION_COMPLETED: "Ihr Rundflug ist abgeschlossen.",
  };
  const messageBody = messages[eventType];
  if (!messageBody) return;
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
        await env.DB.prepare(
          "UPDATE web_push_subscriptions SET status = 'EXPIRED', updated_at = ?1 WHERE id = ?2",
        )
          .bind(new Date().toISOString(), subscription.id)
          .run();
      }
    }),
  );
}

export async function purgeExpiredPushSubscriptions(env: Env, now = new Date()): Promise<number> {
  const result = await env.DB.prepare(
    "DELETE FROM web_push_subscriptions WHERE delete_after <= ?1 OR status <> 'ACTIVE'",
  )
    .bind(now.toISOString())
    .run();
  return result.meta.changes;
}
