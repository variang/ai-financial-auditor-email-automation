import type { ReplyPayload } from "../../domain/types.js";

export interface ReplyService {
  send(payload: ReplyPayload): Promise<void>;
}

export class StubReplyService implements ReplyService {
  async send(payload: ReplyPayload): Promise<void> {
    const body = [
      "Your credit statement audit is ready.",
      `Sheet: ${payload.sheetUrl}`,
      "Summary:",
      ...payload.auditSummaryLines
    ].join("\n");

    console.log(
      JSON.stringify({
        type: "stub-reply-dispatched",
        recipient: payload.recipientEmail,
        subject: payload.subject,
        body
      })
    );
  }
}
