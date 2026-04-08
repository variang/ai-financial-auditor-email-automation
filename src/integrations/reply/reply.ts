import type { ReplyPayload } from "../../domain/types.js";
import { google, type gmail_v1 } from "googleapis";

export interface ReplyService {
  send(payload: ReplyPayload): Promise<void>;
}

export type GmailReplyAuthConfig =
  | {
      kind: "service-account";
      credentialsPath: string;
    }
  | {
      kind: "oauth";
      clientId: string;
      clientSecret: string;
      refreshToken: string;
    };

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function formatReplyBody(payload: ReplyPayload): string {
  const summaryLines = payload.auditSummaryLines.map((line) => `- ${line}`);
  return [
    "Your credit statement audit is ready.",
    `Sheet URL: ${payload.sheetUrl}`,
    "",
    "Audit summary:",
    ...summaryLines
  ].join("\n");
}

export function shouldSendReply(recipientEmail: string): boolean {
  const normalized = recipientEmail.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.endsWith("@placeholder.invalid")) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function buildRawReplyMessage(payload: ReplyPayload): string {
  const headers = [
    `To: ${sanitizeHeaderValue(payload.recipientEmail)}`,
    `Subject: ${sanitizeHeaderValue(payload.subject)}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0"
  ];
  const body = formatReplyBody(payload);
  const raw = [...headers, "", body].join("\r\n");

  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export class RealGmailReplyService implements ReplyService {
  private readonly client: gmail_v1.Gmail;

  constructor(
    authConfig: GmailReplyAuthConfig,
    private readonly logger: Pick<Console, "warn"> = console
  ) {
    const auth = this.createAuthClient(authConfig);
    this.client = google.gmail({ version: "v1", auth });
  }

  async send(payload: ReplyPayload): Promise<void> {
    if (!shouldSendReply(payload.recipientEmail)) {
      this.logger.warn(
        JSON.stringify({
          type: "reply-skipped-invalid-recipient",
          recipient: payload.recipientEmail,
          subject: payload.subject
        })
      );
      return;
    }

    try {
      await this.client.users.messages.send({
        userId: "me",
        requestBody: {
          raw: buildRawReplyMessage(payload)
        }
      });
    } catch (error) {
      throw this.buildGmailError(error, "Failed to send Gmail reply");
    }
  }

  private createAuthClient(authConfig: GmailReplyAuthConfig) {
    if (authConfig.kind === "oauth") {
      const auth = new google.auth.OAuth2(
        authConfig.clientId,
        authConfig.clientSecret
      );
      auth.setCredentials({ refresh_token: authConfig.refreshToken });
      return auth;
    }

    return new google.auth.GoogleAuth({
      keyFile: authConfig.credentialsPath,
      scopes: ["https://www.googleapis.com/auth/gmail.send"]
    });
  }

  private buildGmailError(error: unknown, prefix: string): Error {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : undefined;

    const message =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "unknown error";

    if (status === 401) {
      return new Error(`${prefix}: unauthorized (401). ${message}`);
    }

    if (status === 403) {
      return new Error(`${prefix}: permission denied (403). ${message}`);
    }

    if (status === 404) {
      return new Error(`${prefix}: account not found (404). ${message}`);
    }

    if (status === 429) {
      return new Error(`${prefix}: rate limited (429). ${message}`);
    }

    return new Error(`${prefix}: ${message}`);
  }
}

export class StubReplyService implements ReplyService {
  async send(payload: ReplyPayload): Promise<void> {
    const body = formatReplyBody(payload);

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
