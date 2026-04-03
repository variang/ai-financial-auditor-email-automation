import type { AppConfig } from "../config/env.js";
import type { ReplyPayload, StatementSummary } from "../domain/types.js";
import type { LlmClient } from "../integrations/llm/client.js";
import type { ReplyService } from "../integrations/reply/reply.js";
import type { SheetsService } from "../integrations/sheets/service.js";
import type { WorkflowState } from "./state.js";

function buildTabName(statementDate: string, cardNickname: string): string {
  return `${statementDate}_${cardNickname}`;
}

export function summarizeTransactions(state: WorkflowState): StatementSummary {
  const totalSpending = state.transactions.reduce((sum, tx) => sum + tx.amount, 0);
  return {
    statementDate: state.statementDate,
    totalSpending,
    transactionCount: state.transactions.length,
    cardNickname: state.cardNickname
  };
}

export async function composeReplyPayload(
  state: WorkflowState,
  config: AppConfig,
  llm: LlmClient
): Promise<ReplyPayload> {
  const summary = state.summary;
  if (!summary || !state.sheetUrl) {
    throw new Error("Cannot compose reply without summary and sheet URL.");
  }

  const llmSummary = await llm.generate({
    instruction: "Generate concise audit summary lines.",
    context: {
      statementDate: summary.statementDate,
      transactionCount: summary.transactionCount,
      totalSpending: summary.totalSpending,
      cardNickname: summary.cardNickname
    }
  });

  const auditSummaryLines = [
    `Card: ${summary.cardNickname}`,
    `Statement Date: ${summary.statementDate}`,
    `Transactions: ${summary.transactionCount}`,
    `Total Spending: ${summary.totalSpending.toFixed(2)}`,
    llmSummary.text
  ].slice(0, config.replySummaryMaxLines);

  return {
    recipientEmail: state.recipientEmail,
    subject: `Audit Complete - ${summary.statementDate} ${summary.cardNickname}`,
    sheetUrl: state.sheetUrl,
    auditSummaryLines
  };
}

export async function runWorkflowSteps(
  state: WorkflowState,
  config: AppConfig,
  deps: {
    llm: LlmClient;
    sheets: SheetsService;
    reply: ReplyService;
  }
): Promise<WorkflowState> {
  const summary = summarizeTransactions(state);
  const tabName = buildTabName(summary.statementDate, summary.cardNickname);

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

  const nextState: WorkflowState = {
    ...state,
    summary,
    tabName,
    sheetUrl
  };

  if (config.autoReplyEnabled) {
    const reply = await composeReplyPayload(nextState, config, deps.llm);
    await deps.reply.send(reply);
    nextState.reply = reply;
  }

  return nextState;
}
