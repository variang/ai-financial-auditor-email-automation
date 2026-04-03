import type { GmailPushEvent } from "../../domain/types.js";

export interface GmailTriggerPort {
  decodePushEvent(input: string): GmailPushEvent;
}

export class StubGmailTriggerPort implements GmailTriggerPort {
  decodePushEvent(_input: string): GmailPushEvent {
    return {
      messageId: "stub-message-id",
      threadId: "stub-thread-id",
      historyId: "stub-history-id",
      receivedAtIso: new Date().toISOString()
    };
  }
}
