import { assessForecastFreshness } from "@rundflug/domain";
import { PUBLIC_STATUS_MESSAGES } from "./public-status-copy";
import { safeErrorMessage } from "./snapshot";
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
  gate_label: string;
  origin: string | null;
}

export interface VapidConfiguration {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** Ein Versand ist erst mit allen drei Werten möglich; die Statusseite darf nichts anderes melden. */
export function vapidConfiguration(env: Env): VapidConfiguration | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
}

/** Laufzeitfehler können die aufgerufene URL führen; Push-Endpunkte gehören nie in Protokolle. */
export function pushErrorMessage(reason: unknown): string {
  return safeErrorMessage(reason).replaceAll(/https?:\/\/\S+/g, "[endpunkt]");
}

const DEFAULT_PUSH_RETENTION_DAYS = 7;
const PUSH_TITLES = {
  PREPARE_FOR_FLIGHT: "Bitte bereithalten",
  GO_TO_GATE: "Bitte zum Gate",
  BOARDING_STARTED: "Boarding hat begonnen",
  ROTATION_STARTED: "Rundflug gestartet",
  ROTATION_LANDED: "Rundflug gelandet",
  ROTATION_COMPLETED: "Rundflug abgeschlossen",
} as const;
export type PushNotificationType = keyof typeof PUSH_TITLES;

export function pushNotificationFor(
  eventType: PushNotificationType,
  gateLabel: string,
): { title: string; body: string } {
  const body = {
    PREPARE_FOR_FLIGHT: `Ihr Aufruf steht bevor. Bitte halten Sie sich in der Nähe von „${gateLabel}“ bereit.`,
    GO_TO_GATE: `Bitte kommen Sie jetzt zu „${gateLabel}“ und warten Sie dort auf den Boardingaufruf.`,
    BOARDING_STARTED: `Das Boarding an „${gateLabel}“ hat begonnen. Bitte halten Sie Ihr Ticket für den Einstieg bereit.`,
    ROTATION_STARTED: PUBLIC_STATUS_MESSAGES.IN_FLIGHT,
    ROTATION_LANDED: PUBLIC_STATUS_MESSAGES.LANDED,
    ROTATION_COMPLETED: PUBLIC_STATUS_MESSAGES.COMPLETED,
  } satisfies Record<PushNotificationType, string>;
  return { title: PUSH_TITLES[eventType], body: body[eventType] };
}

export function pushUrgencyFor(eventType: PushNotificationType): "normal" | "high" {
  return eventType === "GO_TO_GATE" || eventType === "BOARDING_STARTED" ? "high" : "normal";
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

export function publicPushNavigateOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}

export function publicPushPayload(
  eventType: PushNotificationType,
  targetPath: string,
  origin: string | null,
  gateLabel: string,
): string {
  const copy = pushNotificationFor(eventType, gateLabel);
  const notification = {
    title: copy.title,
    lang: "de",
    dir: "ltr",
    body: copy.body,
    data: { url: targetPath },
  };
  const navigateOrigin = publicPushNavigateOrigin(origin);
  // Safari parst `navigate` ohne Basis-URL und verwirft eine deklarative Nachricht vollständig,
  // sobald daraus keine gültige URL entsteht. Ohne bekannten Ursprung bleibt deshalb nur der
  // klassische Payload, den der Service Worker anzeigt.
  if (!navigateOrigin) return JSON.stringify(notification);
  return JSON.stringify({
    web_push: 8030,
    notification: { ...notification, navigate: `${navigateOrigin}${targetPath}` },
  });
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
  const vapid = vapidConfiguration(env);
  if (!vapid) {
    console.warn(
      JSON.stringify({
        level: "warn",
        code: "WEB_PUSH_NOT_CONFIGURED",
        notificationType: eventType,
        queued: queued.meta.changes,
      }),
    );
    return queued.meta.changes;
  }
  const subscriptions = await env.DB.prepare(
    `SELECT d.id AS delivery_id, w.id, w.endpoint, w.p256dh, w.auth, w.target_kind, w.origin,
            t.public_code AS ticket_public_code,
            tg.public_status_code AS group_public_code,
            g.label AS gate_label
       FROM web_push_deliveries d
       JOIN web_push_subscriptions w ON w.id = d.subscription_id
       JOIN tickets t ON t.id = w.ticket_id
       JOIN ticket_groups tg ON tg.id = t.ticket_group_id
       JOIN products p ON p.id = tg.product_id
       JOIN rotations r ON r.id = d.rotation_id
       JOIN gates g ON g.id = COALESCE(r.gate_id, p.gate_id)
      WHERE d.rotation_id = ?1 AND d.notification_type = ?2 AND d.status = 'PENDING'
        AND w.status = 'ACTIVE' AND w.delete_after > ?3
        AND (
          (w.target_kind = 'TICKET' AND t.public_code IS NOT NULL)
          OR (w.target_kind = 'GROUP' AND tg.public_status_code IS NOT NULL)
        )`,
  )
    .bind(rotationId, eventType, now)
    .all<StoredPushSubscription>();
  await Promise.allSettled(
    subscriptions.results.map(async (subscription) => {
      try {
        const targetPath = publicPushTargetPath({
          targetKind: subscription.target_kind,
          ticketCode: subscription.ticket_public_code,
          groupCode: subscription.group_public_code,
        });
        if (!targetPath) return;
        const payload = await buildWebPushRequest({
          data: publicPushPayload(
            eventType,
            targetPath,
            subscription.origin,
            subscription.gate_label,
          ),
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
          ttl: 300,
          urgency: pushUrgencyFor(eventType),
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
        // Der Push-Dienst ist der einzige Zeuge einer abgelehnten Zustellung; ohne dieses
        // Protokoll bleibt die Ablehnung in der Zustellzeile nicht von einem Netzfehler
        // unterscheidbar. Der Endpunkt selbst bleibt außen vor, nur sein Dienst wird benannt.
        const pushService = new URL(subscription.endpoint).host;
        if (response.status === 404 || response.status === 410) {
          console.info(
            JSON.stringify({
              level: "info",
              code: "WEB_PUSH_SUBSCRIPTION_EXPIRED",
              deliveryId: subscription.delivery_id,
              notificationType: eventType,
              status: response.status,
              pushService,
            }),
          );
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
          console.warn(
            JSON.stringify({
              level: "warn",
              code: "WEB_PUSH_DELIVERY_REJECTED",
              deliveryId: subscription.delivery_id,
              notificationType: eventType,
              status: response.status,
              pushService,
            }),
          );
          await env.DB.prepare("UPDATE web_push_deliveries SET last_attempt_at = ?1 WHERE id = ?2")
            .bind(new Date().toISOString(), subscription.delivery_id)
            .run();
        }
      } catch (reason: unknown) {
        console.error(
          JSON.stringify({
            level: "error",
            code: "WEB_PUSH_DELIVERY_FAILED",
            deliveryId: subscription.delivery_id,
            notificationType: eventType,
            message: pushErrorMessage(reason),
          }),
        );
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
            fg.precall_decision_status,
            od.notification_lead_minutes, od.operational_interrupted, od.emergency_mode
       FROM rotations r
       JOIN flight_groups fg ON fg.id = r.flight_group_id
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
      precall_decision_status: "WAITING" | "PREPARE" | "GO_TO_GATE" | null;
      notification_lead_minutes: number;
      operational_interrupted: number;
      emergency_mode: number;
    }>();
  const now = new Date().toISOString();
  const eligible = rows.results.filter(
    (row) =>
      row.precall_decision_status === "PREPARE" &&
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
