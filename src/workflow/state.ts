import type {
  GmailPushEvent,
  ReplyPayload,
  StatementSummary,
  StatementTransaction
} from "../domain/types.js";

export interface WorkflowState {
  event: GmailPushEvent;
  recipientEmail: string;
  cardNickname: string;
  statementDate: string;
  transactions: StatementTransaction[];
  summary?: StatementSummary;
  tabName?: string;
  sheetUrl?: string;
  reply?: ReplyPayload;
}
