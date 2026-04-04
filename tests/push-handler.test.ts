import { describe, expect, it } from "vitest";
import { GmailPushDecoder } from "../src/integrations/gmail/trigger.js";

function buildEnvelope(data: unknown, overrides?: Record<string, unknown>): string {
  const notification = Buffer.from(JSON.stringify(data)).toString("base64");
  return JSON.stringify({
    message: {
      data: notification,
      messageId: "test-pubsub-message-id",
      publishTime: "2026-04-04T08:00:00Z",
      attributes: {}
    },
    subscription: "projects/test/subscriptions/gmail-test",
    ...overrides
  });
}

const VALID_NOTIFICATION = { emailAddress: "vari.ang98@gmail.com", historyId: 42000 };

describe("GmailPushDecoder", () => {
  const decoder = new GmailPushDecoder();

  it("decodes a valid Pub/Sub push payload", () => {
    const raw = buildEnvelope(VALID_NOTIFICATION);
    const event = decoder.decodePushEvent(raw);

    expect(event.messageId).toBe("test-pubsub-message-id");
    expect(event.historyId).toBe("42000");
    expect(event.receivedAtIso).toBe("2026-04-04T08:00:00Z");
    expect(event.threadId).toBe("");
  });

  it("accepts historyId as a string", () => {
    const raw = buildEnvelope({ emailAddress: "vari.ang98@gmail.com", historyId: "55000" });
    const event = decoder.decodePushEvent(raw);
    expect(event.historyId).toBe("55000");
  });

  it("throws on invalid JSON body", () => {
    expect(() => decoder.decodePushEvent("not-json")).toThrowError(
      /body is not valid JSON/
    );
  });

  it("throws when Pub/Sub envelope is missing required fields", () => {
    expect(() =>
      decoder.decodePushEvent(JSON.stringify({ subscription: "x" }))
    ).toThrowError(/Invalid Pub\/Sub envelope/);
  });

  it("throws when message.data is not valid base64 JSON", () => {
    const raw = JSON.stringify({
      message: {
        data: Buffer.from("not-valid-json-at-all{{{").toString("base64"),
        messageId: "id",
        publishTime: "2026-04-04T00:00:00Z"
      },
      subscription: "projects/test/subscriptions/s"
    });
    expect(() => decoder.decodePushEvent(raw)).toThrowError(
      /Invalid Pub\/Sub message/
    );
  });

  it("throws when Gmail notification is missing emailAddress", () => {
    const raw = buildEnvelope({ historyId: 100 });
    expect(() => decoder.decodePushEvent(raw)).toThrowError(
      /Invalid Gmail notification payload/
    );
  });

  it("throws when Gmail notification has invalid email", () => {
    const raw = buildEnvelope({ emailAddress: "not-an-email", historyId: 100 });
    expect(() => decoder.decodePushEvent(raw)).toThrowError(
      /Invalid Gmail notification payload/
    );
  });
});
