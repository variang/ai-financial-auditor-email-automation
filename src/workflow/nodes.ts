import type { AppConfig } from "../config/env.js";
import type { ReplyPayload, StatementSummary } from "../domain/types.js";
import type { LlmClient } from "../integrations/llm/client.js";
import type { WorkflowState } from "./state.js";

export function buildTabName(statementDate: string, cardNickname: string): string {
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
