import type { FactoryResetResponse } from "@rundflug/contracts";
import type { Context } from "hono";
import type { SessionActor } from "./auth";
import type { factoryResetRequestHash } from "./factory-reset";
import type { FactoryResetRouteDependencies } from "./factory-reset-routes";
import type { Env } from "./types";

type WorkerContext = Context<{
  Bindings: Env;
  Variables: { sessionActor: SessionActor | null };
}>;

export type FactoryResetInput = Parameters<typeof factoryResetRequestHash>[0];
export interface FactoryResetReceipt {
  completed_at: string;
  r2_cleanup_pending: number;
  request_hash: string;
  response_json: string;
  setup_browser_binding_hash: string | null;
}

export async function replayFactoryReset(
  context: WorkerContext,
  dependencies: FactoryResetRouteDependencies,
  input: FactoryResetInput,
  requestHash: string,
  prior: FactoryResetReceipt,
): Promise<Response> {
  const browserBindingHash = await dependencies.sessionBrowserBindingHash(context.req.raw);
  if (
    !browserBindingHash ||
    !prior.setup_browser_binding_hash ||
    browserBindingHash !== prior.setup_browser_binding_hash
  ) {
    return context.json(
      { error: { code: "ADMIN_REQUIRED", message: "Administration erforderlich." } },
      403,
    );
  }
  if (prior.request_hash !== requestHash) {
    return context.json(
      { error: { code: "IDEMPOTENCY_CONFLICT", message: "Reset-ID ist bereits belegt." } },
      409,
    );
  }
  let response = JSON.parse(prior.response_json) as FactoryResetResponse;
  if (prior.r2_cleanup_pending) {
    response = await dependencies.finishR2Cleanup(context.env, input.commandId, response);
  }
  const token = await dependencies.resetSetupToken(
    context.env,
    input.commandId,
    prior.completed_at,
  );
  if (token) context.header("set-cookie", dependencies.resetSetupCookie(token, context.req.raw));
  return context.json(response);
}

export async function finalizeFactoryReset(
  context: WorkerContext,
  dependencies: FactoryResetRouteDependencies,
  input: FactoryResetInput,
  response: FactoryResetResponse,
  grantToken: string,
): Promise<Response> {
  if (input.deleteAllBackups) {
    try {
      const completedResponse = await dependencies.finishR2Cleanup(
        context.env,
        input.commandId,
        response,
      );
      context.header("set-cookie", dependencies.resetSetupCookie(grantToken, context.req.raw));
      return context.json(completedResponse);
    } catch {
      context.header("set-cookie", dependencies.resetSetupCookie(grantToken, context.req.raw));
      return context.json(response, 202);
    }
  }
  context.header("set-cookie", dependencies.resetSetupCookie(grantToken, context.req.raw));
  return context.json(response);
}
