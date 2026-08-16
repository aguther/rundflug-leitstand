import { APP_NAME, APP_VERSION, REQUIREMENTS_VERSION } from "@rundflug/config";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { registerAdminAccountRoutes } from "./admin-account-routes";
import { registerAdminEventCloneRoutes } from "./admin-event-clone-routes";
import { registerAdminEventDeletionRoutes } from "./admin-event-deletion-routes";
import { registerAdminEventLogoRoutes } from "./admin-event-logo-routes";
import { registerAdminEventRoutes } from "./admin-event-routes";
import { registerAdminMasterDataTemplateRoutes } from "./admin-master-data-template-routes";
import { registerAdminSecurityRoutes } from "./admin-security-routes";
import { registerAnalysisControlRoutes } from "./analysis-control-routes";
import { registerApiCachePolicy } from "./api-cache-policy";
import type { SessionActor } from "./auth";
import { registerAuthRoutes } from "./auth-routes";
import { registerControlCoordinationRoutes } from "./control-coordination-routes";
import { registerControlSessionMiddleware } from "./control-session-middleware";
import { registerControlTransportRoutes } from "./control-transport-routes";
import { registerDeviceRoutes } from "./device-routes";

export { EventCoordinator } from "./event-coordinator";
export { PlanningHistoryCompactionWorkflow } from "./planning-history-workflow";

import { registerFactoryResetRoutes } from "./factory-reset-routes";
import { registerFidsControlRoutes } from "./fids-control-routes";
import { registerHistoryRoutes } from "./history-routes";
import { registerOperationsRoutes } from "./operations-routes";
import { startPlanningHistoryWorkflows } from "./planning-history-workflow";
import { allowUnknownTicketAttempt } from "./public-access";
import { registerPublicBoardRoutes } from "./public-board-routes";
import { registerPublicInstallRoutes } from "./public-install-routes";
import { registerPublicLogoRoutes } from "./public-logo-routes";
import { registerPublicPushRoutes } from "./public-push-routes";
import { registerPublicStatusRoutes } from "./public-status-routes";
import { registerReportExportRoutes } from "./report-export-routes";
import { limitApiBody, requireValidJsonBody } from "./request-body-boundaries";
import { runScheduledMaintenance } from "./scheduled-maintenance";
import { registerSetupRoutes } from "./setup-routes";
import { registerSimulationPlanExportRoutes } from "./simulation-plan-export-routes";
import { safeErrorMessage } from "./snapshot";
import { registerTicketReadRoutes } from "./ticket-read-routes";
import { httpsRedirectLocation } from "./transport-security";
import type { Env } from "./types";

const app = new Hono<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>();

app.use("*", async (context, next) => {
  const redirectLocation = httpsRedirectLocation(context.req.url, context.env.APP_ENV);
  if (redirectLocation) return context.redirect(redirectLocation, 308);
  await next();
});

async function unknownTicketResponse(env: Env, request: Request): Promise<Response> {
  if (!(await allowUnknownTicketAttempt(env.PUBLIC_TICKET_RATE_LIMITER, request))) {
    return Response.json(
      { error: { code: "TOO_MANY_TICKET_ATTEMPTS", message: "Bitte später erneut versuchen." } },
      { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } },
    );
  }
  return Response.json(
    { error: { code: "TICKET_NOT_FOUND", message: "Ticket nicht gefunden." } },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

function eventCoordinatorNamespace(env: Env): Env["EVENT_COORDINATOR"] {
  // workerd/miniflare does not implement jurisdiction restrictions locally.
  // Acceptance and production always request the EU jurisdiction explicitly.
  return env.APP_ENV === "development"
    ? env.EVENT_COORDINATOR
    : env.EVENT_COORDINATOR.jurisdiction("eu");
}

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: "no-referrer",
    xContentTypeOptions: "nosniff",
    xFrameOptions: "DENY",
  }),
);

registerApiCachePolicy(app);

app.use("/api/*", limitApiBody);
app.use("/api/*", requireValidJsonBody);

registerControlSessionMiddleware(app);

app.get("/api/health", (context) =>
  context.json({
    ok: true,
    service: APP_NAME,
    applicationVersion: APP_VERSION,
    environment: context.env.APP_ENV,
    requirementsVersion: REQUIREMENTS_VERSION,
    timestamp: new Date().toISOString(),
  }),
);

app.get("/api/meta", (context) =>
  context.json({
    applicationVersion: APP_VERSION,
    architecture: "Cloudflare Worker + Static Assets + D1 + Durable Object + R2",
    dataJurisdiction: context.env.DATA_JURISDICTION,
    productionReady: false,
    requirementsVersion: REQUIREMENTS_VERSION,
    sourceRevision: context.env.SOURCE_REVISION?.trim() || "unknown",
  }),
);

registerSetupRoutes(app);

registerAuthRoutes(app);
registerAdminAccountRoutes(app);
registerAdminSecurityRoutes(app);
registerAdminEventRoutes(app);
registerFactoryResetRoutes(app);

registerAdminMasterDataTemplateRoutes(app);

registerSimulationPlanExportRoutes(app);

registerAdminEventCloneRoutes(app);

registerAdminEventDeletionRoutes(app);

registerAdminEventLogoRoutes(app);

registerPublicLogoRoutes(app);

registerControlCoordinationRoutes(app, eventCoordinatorNamespace);

registerFidsControlRoutes(app, eventCoordinatorNamespace);

registerOperationsRoutes(app);

registerAnalysisControlRoutes(app, eventCoordinatorNamespace);

registerTicketReadRoutes(app);

registerHistoryRoutes(app);

registerDeviceRoutes(app);

registerReportExportRoutes(app);

registerPublicInstallRoutes(app);

registerPublicStatusRoutes(app, unknownTicketResponse);
registerPublicPushRoutes(app, unknownTicketResponse);
registerPublicBoardRoutes(app, eventCoordinatorNamespace);

registerControlTransportRoutes(app, eventCoordinatorNamespace);

app.notFound((context) =>
  context.json({ error: { code: "NOT_FOUND", message: "API-Route nicht gefunden." } }, 404),
);

app.onError((error, context) => {
  if (error instanceof SyntaxError) {
    return context.json(
      { error: { code: "INVALID_JSON", message: "JSON-Anfrage ist ungültig." } },
      400,
    );
  }
  console.error(
    JSON.stringify({
      level: "error",
      code: "UNHANDLED_API_ERROR",
      message: safeErrorMessage(error),
    }),
  );
  return context.json({ error: { code: "INTERNAL_ERROR", message: "Interner Fehler." } }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (controller.cron === "0 * * * *") {
      await startPlanningHistoryWorkflows(env, new Date(controller.scheduledTime));
      return;
    }
    await runScheduledMaintenance(env);
    await startPlanningHistoryWorkflows(env, new Date(controller.scheduledTime));
  },
};
