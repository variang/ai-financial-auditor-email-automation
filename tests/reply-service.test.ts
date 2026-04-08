import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplyPayload } from "../src/domain/types.js";

const mocks = vi.hoisted(() => {
  const send = vi.fn();
  const gmailFactory = vi.fn();
  const oauthSetCredentials = vi.fn();
  const googleAuthConstructor = vi.fn();
  const oauthConstructor = vi.fn();

  return {
    send,
    gmailFactory,
    oauthSetCredentials,
    googleAuthConstructor,
    oauthConstructor
  };
});

vi.mock("googleapis", () => {
  class GoogleAuth {
    constructor(options: unknown) {
      mocks.googleAuthConstructor(options);
    }
  }

  class OAuth2 {
    constructor(clientId: string, clientSecret: string) {
      mocks.oauthConstructor({ clientId, clientSecret });
    }

    setCredentials(credentials: unknown) {
      mocks.oauthSetCredentials(credentials);
    }
  }

  return {
    google: {
      auth: {
        GoogleAuth,
        OAuth2
      },
      gmail: mocks.gmailFactory
    }
  };
});

import {
  RealGmailReplyService,
  buildRawReplyMessage,
  formatReplyBody,
  shouldSendReply
} from "../src/integrations/reply/reply.js";

const PAYLOAD: ReplyPayload = {
  recipientEmail: "recipient@example.com",
  subject: "Audit Complete - 2026-04 Visa-1234",
  sheetUrl: "https://docs.google.com/spreadsheets/d/sheet123/edit#gid=321",
  auditSummaryLines: [
    "Card: Visa-1234",
    "Statement Date: 2026-04",
    "Transactions: 12",
    "Total Spending: 325.90"
  ]
};

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = `${base64}${"=".repeat(padLength)}`;
  return Buffer.from(padded, "base64").toString("utf8");
}

describe("reply body formatting", () => {
  it("includes sheet url and summary lines", () => {
    const body = formatReplyBody(PAYLOAD);

    expect(body).toContain("Sheet URL: https://docs.google.com/spreadsheets/d/sheet123/edit#gid=321");
    expect(body).toContain("Audit summary:");
    expect(body).toContain("- Card: Visa-1234");
    expect(body).toContain("- Total Spending: 325.90");
  });

  it("builds RFC822 raw message payload", () => {
    const raw = buildRawReplyMessage(PAYLOAD);
    const decoded = decodeBase64Url(raw);

    expect(decoded).toContain("To: recipient@example.com");
    expect(decoded).toContain("Subject: Audit Complete - 2026-04 Visa-1234");
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded).toContain("Sheet URL: https://docs.google.com/spreadsheets/d/sheet123/edit#gid=321");
    expect(decoded).toContain("- Transactions: 12");
  });

  it("filters placeholder recipients", () => {
    expect(shouldSendReply("unknown@placeholder.invalid")).toBe(false);
    expect(shouldSendReply("recipient@example.com")).toBe(true);
  });
});

describe("RealGmailReplyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.gmailFactory.mockReturnValue({
      users: {
        messages: {
          send: mocks.send
        }
      }
    });

    mocks.send.mockResolvedValue({});
  });

  it("sends Gmail message with base64url raw body", async () => {
    const service = new RealGmailReplyService({
      kind: "service-account",
      credentialsPath: "/tmp/fake-credentials.json"
    });

    await service.send(PAYLOAD);

    expect(mocks.googleAuthConstructor).toHaveBeenCalledWith({
      keyFile: "/tmp/fake-credentials.json",
      scopes: ["https://www.googleapis.com/auth/gmail.send"]
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith({
      userId: "me",
      requestBody: {
        raw: expect.any(String)
      }
    });
  });

  it("skips send for invalid recipient and logs warning", async () => {
    const warn = vi.fn();
    const service = new RealGmailReplyService(
      {
        kind: "service-account",
        credentialsPath: "/tmp/fake-credentials.json"
      },
      { warn }
    );

    await service.send({
      ...PAYLOAD,
      recipientEmail: "unknown@placeholder.invalid"
    });

    expect(mocks.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("maps 403 errors to permission denied", async () => {
    mocks.send.mockRejectedValueOnce({ status: 403, message: "forbidden" });

    const service = new RealGmailReplyService({
      kind: "service-account",
      credentialsPath: "/tmp/fake-credentials.json"
    });

    await expect(service.send(PAYLOAD)).rejects.toThrow(/permission denied \(403\)/i);
  });

  it("uses OAuth refresh token when configured", async () => {
    const service = new RealGmailReplyService({
      kind: "oauth",
      clientId: "oauth-client-id",
      clientSecret: "oauth-client-secret",
      refreshToken: "oauth-refresh-token"
    });

    await service.send(PAYLOAD);

    expect(mocks.oauthConstructor).toHaveBeenCalledWith({
      clientId: "oauth-client-id",
      clientSecret: "oauth-client-secret"
    });
    expect(mocks.oauthSetCredentials).toHaveBeenCalledWith({
      refresh_token: "oauth-refresh-token"
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
