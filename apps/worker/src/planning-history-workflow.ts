import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  buildPlanningHistoryPackage,
  claimPlanningHistoryCompactions,
  markPlanningHistoryFailure,
  markPlanningHistoryWorkflowsDispatched,
  prunePlanningHistoryBatch,
} from "./planning-history-compaction";
import type { Env } from "./types";

export interface PlanningHistoryWorkflowParams {
  compactionId: string;
}

function workflowFailureCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:-]{1,100}$/.test(error.message)) return error.message;
  return "PLANNING_HISTORY_WORKFLOW_FAILED";
}

export class PlanningHistoryCompactionWorkflow extends WorkflowEntrypoint<
  Env,
  PlanningHistoryWorkflowParams
> {
  override async run(
    event: Readonly<WorkflowEvent<PlanningHistoryWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<{ compactionId: string; status: "COMPLETED" }> {
    const { compactionId } = event.payload;
    try {
      await step.do(
        "build and verify immutable package",
        { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } },
        async () => {
          const ready = await buildPlanningHistoryPackage(this.env, compactionId);
          if (!ready) throw new Error("PLANNING_HISTORY_PACKAGE_NOT_READY");
          return true;
        },
      );
      let batch = 0;
      for (;;) {
        const result = await step.do(
          `prune verified batch ${batch}`,
          { retries: { limit: 10, delay: "5 seconds", backoff: "exponential" } },
          async () => prunePlanningHistoryBatch(this.env, compactionId),
        );
        if (result.completed) break;
        batch += 1;
      }
      return { compactionId, status: "COMPLETED" };
    } catch (error) {
      await step.do("record terminal workflow failure", async () => {
        await markPlanningHistoryFailure(this.env, compactionId, workflowFailureCode(error));
      });
      throw error;
    }
  }
}

export async function startPlanningHistoryWorkflows(env: Env, now = new Date()): Promise<number> {
  const compactionIds = await claimPlanningHistoryCompactions(env, now);
  if (compactionIds.length === 0) return 0;
  try {
    await env.PLANNING_HISTORY_COMPACTION.createBatch(
      compactionIds.map((compactionId) => ({
        id: compactionId,
        params: { compactionId },
        retention: { successRetention: "30 days", errorRetention: "30 days" },
      })),
    );
    await markPlanningHistoryWorkflowsDispatched(env, compactionIds, now.toISOString());
  } catch (error) {
    const existingIds = (
      await Promise.all(
        compactionIds.map(async (compactionId) => {
          try {
            const status = await (await env.PLANNING_HISTORY_COMPACTION.get(compactionId)).status();
            return status.status === "unknown" ? null : compactionId;
          } catch {
            return null;
          }
        }),
      )
    ).filter((id): id is string => id !== null);
    await markPlanningHistoryWorkflowsDispatched(env, existingIds, now.toISOString());
    if (existingIds.length !== compactionIds.length) throw error;
  }
  return compactionIds.length;
}
