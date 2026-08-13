import {
  type AnalysisSnapshot,
  analysisArchiveListSchema,
  analysisArchiveRequestSchema,
  analysisArchiveSchema,
  analysisSnapshotRequestSchema,
  analysisSnapshotSchema,
  type OperationBoard,
  operationBoardSchema,
} from "@rundflug/contracts";
import type { Hono } from "hono";
import {
  analysisActorAlias,
  analysisArchiveDownload,
  buildAnalysisArchive,
  deleteAnalysisArchive,
  listAnalysisArchives,
  requestAnalysisArchive,
} from "./analysis-archive";
import { buildAnalysisSnapshot } from "./analysis-snapshot";
import type { SessionActor } from "./auth";
import { authorizeDevice } from "./device-authorization";
import type { Env } from "./types";

type WorkerApp = Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

type EventCoordinatorNamespaceResolver = (env: Env) => Env["EVENT_COORDINATOR"];

const defaultDependencies = {
  analysisActorAlias,
  analysisArchiveDownload,
  analysisSnapshotSchema,
  authorizeDevice,
  buildAnalysisArchive,
  buildAnalysisSnapshot,
  deleteAnalysisArchive,
  listAnalysisArchives,
  operationBoardSchema,
  requestAnalysisArchive,
};

export type AnalysisControlRouteDependencies = typeof defaultDependencies;

function hasAdminAccess(
  actor: SessionActor | null,
  device: { role: string } | null,
): actor is SessionActor {
  return Boolean(actor && device && actor.role === "ADMIN" && device.role === "ADMIN");
}

function snapshotCaptureFailure(code: string): {
  status: 403 | 409 | 412 | 500;
  message: string;
} {
  if (code === "SESSION_NOT_AUTHORIZED") {
    return { status: 403, message: "Für die Diagnose ist eine berechtigte Sitzung erforderlich." };
  }
  if (code === "ANALYSIS_SNAPSHOT_STALE_VERSION") {
    return { status: 412, message: "Die Betriebsdaten wurden inzwischen aktualisiert." };
  }
  if (code === "ANALYSIS_SNAPSHOT_CAPTURE_FAILED") {
    return { status: 500, message: "Der aktuelle Planungslauf konnte nicht erstellt werden." };
  }
  if (code === "ANALYSIS_SNAPSHOT_IDEMPOTENCY_CONFLICT") {
    return {
      status: 409,
      message: "Die Diagnoseanforderung wurde bereits mit anderen Daten verwendet.",
    };
  }
  return { status: 409, message: "Der aktuelle Planungslauf konnte nicht erstellt werden." };
}

function safeSnapshotBuildError(error: unknown): {
  code: string;
  message: string;
} {
  const code = error instanceof Error ? error.message : "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE";
  if (code === "ANALYSIS_SNAPSHOT_NOT_READY") {
    return { code, message: "Der aktuelle Planungslauf ist noch nicht verfügbar." };
  }
  if (["ANALYSIS_SNAPSHOT_CHANGED", "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE"].includes(code)) {
    return { code, message: "Die Diagnose konnte nicht konsistent aufgebaut werden." };
  }
  return {
    code: "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE",
    message: "Die Diagnose konnte nicht konsistent aufgebaut werden.",
  };
}

function archiveConflictMessage(code: string): string {
  if (code === "ANALYSIS_ARCHIVE_EVENT_OPEN") {
    return "Das Tagesarchiv kann erst nach dem Schließen erstellt werden.";
  }
  return "Die Veranstaltungsversion wurde inzwischen geändert.";
}

export function registerAnalysisControlRoutes(
  app: WorkerApp,
  eventCoordinatorNamespace: EventCoordinatorNamespaceResolver,
  dependencies: AnalysisControlRouteDependencies = defaultDependencies,
): void {
  app.post("/api/control/:eventId/analysis/snapshot.json", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = context.get("sessionActor");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw, actor);
    if (
      !actor ||
      !device ||
      !["ADMIN", "FLIGHT_DIRECTOR"].includes(actor.role) ||
      !["ADMIN", "FLIGHT_DIRECTOR"].includes(device.role)
    ) {
      return context.json(
        {
          error: {
            code: "SESSION_NOT_AUTHORIZED",
            message: "Für die Diagnose ist eine berechtigte Sitzung erforderlich.",
          },
        },
        403,
      );
    }
    const request = analysisSnapshotRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!request.success) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_SNAPSHOT_INVALID_REQUEST",
            message: "Die Diagnoseanforderung ist ungültig.",
          },
        },
        400,
      );
    }
    const { requestId, expectedEventVersion } = request.data;
    const readVersion = async (): Promise<number | null> => {
      const row = await context.env.DB.prepare("SELECT version FROM operation_days WHERE id = ?1")
        .bind(eventId)
        .first<{ version: number }>();
      return row?.version ?? null;
    };
    const initialVersion = await readVersion();
    if (initialVersion === null) {
      return context.json(
        { error: { code: "EVENT_NOT_FOUND", message: "Veranstaltung nicht gefunden." } },
        404,
      );
    }
    if (initialVersion !== expectedEventVersion) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_SNAPSHOT_STALE_VERSION",
            message: "Die Betriebsdaten wurden inzwischen aktualisiert.",
            currentVersion: initialVersion,
          },
        },
        412,
      );
    }

    const capture = await eventCoordinatorNamespace(context.env)
      .getByName(eventId)
      .captureAnalysisSnapshot({
        eventId,
        requestId,
        expectedEventVersion,
        deviceId: device.id,
        actorRole: actor.role,
        deviceRole: device.role,
      });
    if (!capture.ok) {
      const failure = snapshotCaptureFailure(capture.code);
      return context.json(
        {
          error: {
            code: capture.code,
            message: failure.message,
            currentVersion: capture.currentVersion,
          },
        },
        failure.status,
      );
    }

    const beforeVersion = await readVersion();
    if (beforeVersion !== expectedEventVersion) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_SNAPSHOT_CHANGED",
            message: "Die Betriebsdaten haben sich während des Exports geändert.",
            currentVersion: beforeVersion ?? undefined,
          },
        },
        409,
      );
    }
    const operationsUrl = new URL(context.req.url);
    operationsUrl.pathname = `/api/control/${encodeURIComponent(eventId)}/operations`;
    operationsUrl.search = "";
    const operationsResponse = await app.request(
      new Request(operationsUrl, { headers: context.req.raw.headers }),
      undefined,
      context.env,
      context.executionCtx,
    );
    if (!operationsResponse.ok) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE",
            message: "Der sichere Betriebszustand konnte nicht aufgebaut werden.",
          },
        },
        409,
      );
    }
    const operationBoard = dependencies.operationBoardSchema.safeParse(
      await operationsResponse.json(),
    );
    if (!operationBoard.success || operationBoard.data.event.version !== expectedEventVersion) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_SNAPSHOT_CHANGED",
            message: "Die Betriebsdaten haben sich während des Exports geändert.",
            currentVersion: operationBoard.success
              ? operationBoard.data.event.version
              : expectedEventVersion,
          },
        },
        409,
      );
    }
    let snapshot: AnalysisSnapshot;
    try {
      snapshot = await dependencies.buildAnalysisSnapshot({
        env: context.env,
        eventId,
        expectedEventVersion,
        planningRunId: capture.planningRunId,
        operationBoard: operationBoard.data as OperationBoard,
      });
    } catch (error) {
      const failure = safeSnapshotBuildError(error);
      return context.json(
        {
          error: {
            code: failure.code,
            message: failure.message,
            currentVersion: (await readVersion()) ?? undefined,
          },
        },
        409,
      );
    }
    const afterVersion = await readVersion();
    if (afterVersion !== expectedEventVersion) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_SNAPSHOT_CHANGED",
            message: "Die Betriebsdaten haben sich während des Exports geändert.",
            currentVersion: afterVersion ?? undefined,
          },
        },
        409,
      );
    }
    const validated = dependencies.analysisSnapshotSchema.parse(snapshot);
    const localTime = validated.manifest.capturedAt.slice(11, 19).replaceAll(":", "-");
    const filename = `rundflug-analyse-momentaufnahme-${validated.manifest.eventDate}-${localTime}.json`;
    return context.body(JSON.stringify(validated), 200, {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
  });

  app.get("/api/control/:eventId/analysis/day-archives", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = context.get("sessionActor");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw, actor);
    if (!hasAdminAccess(actor, device)) {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    return context.json(
      analysisArchiveListSchema.parse({
        archives: await dependencies.listAnalysisArchives(context.env, eventId),
      }),
    );
  });

  app.post("/api/control/:eventId/analysis/day-archives", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = context.get("sessionActor");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw, actor);
    if (!hasAdminAccess(actor, device)) {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    const parsed = analysisArchiveRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_ARCHIVE_REQUEST_INVALID",
            message: "Archivauftrag ist ungültig.",
          },
        },
        400,
      );
    }
    try {
      const result = await dependencies.requestAnalysisArchive({
        env: context.env,
        eventId,
        expectedEventVersion: parsed.data.expectedEventVersion,
        requestId: parsed.data.requestId,
        actorAlias: await dependencies.analysisActorAlias(actor.accountId),
      });
      if (result.created) {
        context.executionCtx.waitUntil(
          dependencies.buildAnalysisArchive(context.env, result.archive.id),
        );
      }
      return context.json(analysisArchiveSchema.parse(result.archive), result.created ? 202 : 200);
    } catch (error) {
      const code = error instanceof Error ? error.message : "ANALYSIS_ARCHIVE_REQUEST_FAILED";
      if (code === "EVENT_NOT_FOUND") {
        return context.json({ error: { code, message: "Veranstaltung nicht gefunden." } }, 404);
      }
      if (code === "ANALYSIS_ARCHIVE_IDEMPOTENCY_CONFLICT") {
        return context.json(
          { error: { code, message: "Die Auftrags-ID wurde bereits anders verwendet." } },
          409,
        );
      }
      if (code === "ANALYSIS_ARCHIVE_STALE_VERSION" || code === "ANALYSIS_ARCHIVE_EVENT_OPEN") {
        return context.json(
          {
            error: {
              code,
              message: archiveConflictMessage(code),
            },
          },
          409,
        );
      }
      throw error;
    }
  });

  app.post("/api/control/:eventId/analysis/day-archives/:archiveId/download", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = context.get("sessionActor");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw, actor);
    if (!hasAdminAccess(actor, device)) {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    const download = await dependencies.analysisArchiveDownload({
      env: context.env,
      eventId,
      archiveId: context.req.param("archiveId"),
      actorAlias: await dependencies.analysisActorAlias(actor.accountId),
    });
    if (!download) {
      return context.json(
        {
          error: {
            code: "ANALYSIS_ARCHIVE_NOT_READY",
            message: "Archiv ist nicht verfügbar.",
          },
        },
        404,
      );
    }
    return new Response(download.object.body, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="rundflug-tagesanalyse-${eventId}-v${download.archive.eventVersion}.zip"`,
        "content-length": String(download.object.size),
        "content-type": "application/zip",
        "x-content-type-options": "nosniff",
      },
    });
  });

  app.delete("/api/control/:eventId/analysis/day-archives/:archiveId", async (context) => {
    const eventId = context.req.param("eventId");
    const actor = context.get("sessionActor");
    const device = await dependencies.authorizeDevice(context.env, eventId, context.req.raw, actor);
    if (!hasAdminAccess(actor, device)) {
      return context.json(
        { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
        403,
      );
    }
    try {
      const archive = await dependencies.deleteAnalysisArchive({
        env: context.env,
        eventId,
        archiveId: context.req.param("archiveId"),
        actorAlias: await dependencies.analysisActorAlias(actor.accountId),
      });
      if (!archive) {
        return context.json(
          { error: { code: "ANALYSIS_ARCHIVE_NOT_FOUND", message: "Archiv nicht gefunden." } },
          404,
        );
      }
      return context.json(analysisArchiveSchema.parse(archive));
    } catch (error) {
      if (error instanceof Error && error.message === "ANALYSIS_ARCHIVE_BUILDING") {
        return context.json(
          { error: { code: error.message, message: "Archiv wird gerade erstellt." } },
          409,
        );
      }
      throw error;
    }
  });
}
