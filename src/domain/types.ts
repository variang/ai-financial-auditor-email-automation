export type RuntimeEnvironment = "development" | "test" | "production";

export interface GmailPushEvent {
  messageId: string;
  threadId: string;
  historyId: string;
  receivedAtIso: string;
}

export interface StatementTransaction {
  id: string;
  cardNickname: string;
  merchant: string;
  amount: number;
  postedDateIso: string;
  statementDate: string;
}

export interface StatementSummary {
  statementDate: string;
  totalSpending: number;
  transactionCount: number;
  cardNickname: string;
}

export interface SheetTabRequest {
  spreadsheetId: string;
  tabName: string;
  ownerEmail: string;
  rows: Array<Record<string, string | number>>;
}

export interface ReplyPayload {
  recipientEmail: string;
  subject: string;
  sheetUrl: string;
  auditSummaryLines: string[];
}
