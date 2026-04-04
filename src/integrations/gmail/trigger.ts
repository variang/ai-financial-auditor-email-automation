import { z } from "zod";
import type { GmailPushEvent } from "../../domain/types.js";

// Shape of the Google Pub/Sub HTTP push request body.
const pubSubEnvelopeSchema = z.object({
  message: z.object({
    data: z.string(),
    messageId: z.string(),
    publishTime: z.string(),
    attributes: z.record(z.string(), z.string()).optional()
  }),
  subscription: z.string()
});

// Shape of the Gmail watch notification decoded from message.data.
// historyId may arrive as a number or string depending on the Gmail API version.
const gmailNotificationSchema = z.object({
  emailAddress: z.string().email(),
  historyId: z.union([z.string(), z.number()]).transform(String)
});

export type PubSubEnvelope = z.infer<typeof pubSubEnvelopeSchema>;
export type GmailNotification = z.infer<typeof gmailNotificationSchema>;

export interface GmailTriggerPort {
  decodePushEvent(rawBody: string): GmailPushEvent;
}

export class GmailPushDecoder implements GmailTriggerPort {
  decodePushEvent(rawBody: string): GmailPushEvent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error("Invalid Pub/Sub push request: body is not valid JSON.");
    }

    const envelope = pubSubEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      const detail = envelope.error.issues.map((i) => i.message).join("; ");
      throw new Error(`Invalid Pub/Sub envelope: ${detail}`);
    }

    let notificationRaw: unknown;
    try {
      const decoded = Buffer.from(envelope.data.message.data, "base64").toString("utf-8");
      notificationRaw = JSON.parse(decoded);
    } catch {
      throw new Error(
        "Invalid Pub/Sub message: data field is not valid base64-encoded JSON."
      );
    }

    const notification = gmailNotificationSchema.safeParse(notificationRaw);
    if (!notification.success) {
      const detail = notification.error.issues.map((i) => i.message).join("; ");
      throw new Error(`Invalid Gmail notification payload: ${detail}`);
    }

    return {
      // messageId is the Pub/Sub message ID. The Gmail message ID is resolved
      // later via the History API using historyId.
      messageId: envelope.data.message.messageId,
      // threadId is populated in a future step via Gmail History API.
      threadId: "",
      historyId: notification.data.historyId,
      receivedAtIso: envelope.data.message.publishTime
    };
  }
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
