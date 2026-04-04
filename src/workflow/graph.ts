import { END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import type { AppConfig } from "../config/env.js";
import type { LlmClient } from "../integrations/llm/client.js";
import type { ReplyService } from "../integrations/reply/reply.js";
import type { SheetsService } from "../integrations/sheets/service.js";
import {
  buildTabName,
  composeReplyPayload,
  summarizeTransactions
} from "./nodes.js";
import type { WorkflowState } from "./state.js";
import { metrics } from "../observability/metrics/prometheus.js";

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
  transactions: z.array(z.any()),
  summary: z.any().optional(),
  tabName: z.string().optional(),
  sheetUrl: z.string().optional(),
  reply: z.any().optional()
});

function createWorkflowGraph(config: AppConfig, deps: GraphDependencies) {
  const graph = new StateGraph(workflowStateSchema);

  // Node 1: Ingest - record metrics for incoming transaction batch
  graph.addNode("ingest", (state: WorkflowState) => {
    metrics.addTransactions(state.transactions.length);
    return state;
  });

  // Node 2: Summarize - calculate statement summary (totals, counts)
  graph.addNode("summarize", (state: WorkflowState) => {
    const summary = summarizeTransactions(state);
    return { ...state, summary };
  });

  // Node 3: Upsert Sheet - write transactions to Google Sheets
  graph.addNode("upsertSheet", async (state: WorkflowState) => {
    if (!state.summary) {
      throw new Error("Summary must be computed before upserting sheet.");
    }
    const tabName = buildTabName(
      state.summary.statementDate,
      state.summary.cardNickname
    );
    const { sheetUrl } = await deps.sheets.upsertTab({
      spreadsheetId: config.spreadsheetId,
      ownerEmail: config.ownerEmail,
      tabName,
      rows: state.transactions.map((transaction) => ({
        id: transaction.id,
        merchant: transaction.merchant,
        amount: transaction.amount,
        postedDateIso: transaction.postedDateIso,
        statementDate: transaction.statementDate,
        cardNickname: transaction.cardNickname
      }))
    });
    metrics.recordSheetUpsert();
    return { ...state, tabName, sheetUrl };
  });

  // Node 4: Compose Reply - optionally compose and send reply email
  graph.addNode("composeReply", async (state: WorkflowState) => {
    if (!config.autoReplyEnabled) {
      return state;
    }
    if (!state.sheetUrl) {
      throw new Error("Sheet URL must be set before composing reply.");
    }
    const reply = await composeReplyPayload(state, config, deps.llm);
    await deps.reply.send(reply);
    metrics.recordReplySent();
    return { ...state, reply };
  });

  // Build execution path: START → ingest → summarize → upsertSheet → composeReply → END
  (graph.addEdge as any)(START, "ingest");
  (graph.addEdge as any)("ingest", "summarize");
  (graph.addEdge as any)("summarize", "upsertSheet");
  (graph.addEdge as any)("upsertSheet", "composeReply");
  (graph.addEdge as any)("composeReply", END);

  return graph.compile();
}

export async function executeWorkflow(
  input: WorkflowState,
  config: AppConfig,
  deps: GraphDependencies
): Promise<WorkflowState> {
  const graph = createWorkflowGraph(config, deps);
  const result = await graph.invoke(input);
  return result;
}
