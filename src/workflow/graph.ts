import { END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";
import type { LlmClient } from "../integrations/llm/client.js";
import type { ReplyService } from "../integrations/reply/reply.js";
import type { SheetsService } from "../integrations/sheets/service.js";
import { runWorkflowSteps } from "./nodes.js";
import type { WorkflowState } from "./state.js";

type GraphDependencies = {
  llm: LlmClient;
  sheets: SheetsService;
  reply: ReplyService;
};

const workflowStateSchema = z.object({
  event: z.any(),
  recipientEmail: z.string(),
  cardNickname: z.string(),
  statementDate: z.string(),
  transactions: z.array(z.any())
});

// We keep this tiny StateGraph builder to anchor LangGraph integration in the baseline.
function createLangGraphSkeleton(): string {
  const graph = new StateGraph(workflowStateSchema)
    .addNode("process", (state) => ({ recipientEmail: state.recipientEmail }))
    .addEdge(START, "process")
    .addEdge("process", END)
    .compile();

  return graph ? "ready" : "not-ready";
}

export async function executeWorkflow(
  input: WorkflowState,
  config: AppConfig,
  deps: GraphDependencies
): Promise<WorkflowState> {
  void createLangGraphSkeleton();
  return runWorkflowSteps(input, config, deps);
}
