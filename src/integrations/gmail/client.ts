import { google, type gmail_v1 } from "googleapis";
import { PDFParse } from "pdf-parse";
import type { Logger } from "../../utils/logger.js";

export interface GmailFetchResult {
  pdfText: string;
  recipientEmail: string;
  cardNickname: string;
  threadId: string;
}

export interface GmailFetchInput {
  historyId: string;
  emailAddress: string;
}

export interface GmailFetchService {
  fetch(input: GmailFetchInput): Promise<GmailFetchResult>;
}

export type GmailFetchAuthConfig =
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

export class StubGmailFetchService implements GmailFetchService {
  async fetch(_input: GmailFetchInput): Promise<GmailFetchResult> {
    return {
      pdfText: `Credit Card Statement
Cardholder: John Doe
Card: Visa ending in 1234
Statement Period: April 1 - April 30, 2026

Transactions:
04/05/26  Coffee Shop          Purchase    $6.75      Balance: $1,000.00
04/08/26  Whole Foods          Purchase    $42.20     Balance: $993.25
04/10/26  Gas Station          Purchase    $45.00     Balance: $951.05
04/15/26  Restaurant Downtown  Purchase    $75.50     Balance: $905.55
04/20/26  Online Retailer      Purchase    $125.99    Balance: $779.56
04/25/26  Pharmacy            Purchase    $23.45     Balance: $756.11

Total Purchases: $318.89`,
      recipientEmail: "recipient@example.com",
      cardNickname: "Visa-1234",
      threadId: "sample-thread-001"
    };
  }
}

export class RealGmailFetchService implements GmailFetchService {
  private readonly client: gmail_v1.Gmail;
  private readonly logger: Logger;

  constructor(authConfig: GmailFetchAuthConfig, logger: Logger) {
    const auth = RealGmailFetchService.createAuthClient(authConfig);
    this.client = google.gmail({ version: "v1", auth });
    this.logger = logger;
  }

  private static createAuthClient(authConfig: GmailFetchAuthConfig) {
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
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify"
      ]
    });
  }

  async fetch(input: GmailFetchInput): Promise<GmailFetchResult> {
    let messageId: string | undefined;
    try {
      messageId = await this.resolveMessageId(input.historyId);

      const message = await this.client.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full"
      });

      if (!message.data.payload) {
        throw new Error("Message payload is missing");
      }

      const headers = message.data.payload.headers || [];
      const fromHeader = headers.find((h) => h.name === "From")?.value || "";
      const subjectHeader = headers.find((h) => h.name === "Subject")?.value || "";
      const threadId = message.data.threadId || "";

      const emailMatch = fromHeader.match(/<([^>]+)>/);
      const recipientEmail = emailMatch ? emailMatch[1] : fromHeader.trim();

      const cardMatch = subjectHeader.match(/(Visa|Amex|Mastercard|Discover)[^$]*/i);
      const cardNickname = cardMatch
        ? cardMatch[0].trim()
        : "Statement";

      const pdfText = await this.extractPdfText(messageId, message.data.payload);

      if (!pdfText) {
        throw new Error("No PDF text found in message attachments");
      }

      this.logger.info("gmail-message-fetched", {
        messageId,
        historyId: input.historyId,
        recipientEmail,
        cardNickname,
        pdfTextLength: pdfText.length
      });

      return {
        pdfText,
        recipientEmail,
        cardNickname,
        threadId
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("gmail-fetch-failed", {
        historyId: input.historyId,
        messageId,
        message
      });
      throw error;
    }
  }

  // The Gmail push notification only carries historyId. To find the message
  // that triggered it, query history.list (preferred), and fall back to the
  // most recent message with a PDF attachment if history is empty (e.g. when
  // the watermark has already advanced past the change).
  private async resolveMessageId(historyId: string): Promise<string> {
    const historyResponse = await this.client.users.history.list({
      userId: "me",
      startHistoryId: historyId,
      historyTypes: ["messageAdded"]
    });

    const records = historyResponse.data.history || [];
    for (const record of records) {
      for (const added of record.messagesAdded || []) {
        const id = added.message?.id;
        if (id) {
          return id;
        }
      }
    }

    this.logger.warn("gmail-history-empty-falling-back-to-list", { historyId });

    const listResponse = await this.client.users.messages.list({
      userId: "me",
      q: "has:attachment filename:pdf",
      maxResults: 1
    });

    const fallbackId = listResponse.data.messages?.[0]?.id;
    if (!fallbackId) {
      throw new Error(
        `Unable to resolve a Gmail message for historyId=${historyId}: history.list returned no messageAdded records and messages.list found no PDF attachments.`
      );
    }

    return fallbackId;
  }

  private async extractPdfText(
    messageId: string,
    payload: gmail_v1.Schema$MessagePart
  ): Promise<string> {
    if (payload.mimeType === "application/pdf" && payload.body?.attachmentId) {
      const attachment = await this.client.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: payload.body.attachmentId
      });

      if (!attachment.data.data) {
        throw new Error("Attachment data is missing");
      }

      const buffer = Buffer.from(attachment.data.data, "base64");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        return result.text;
      } finally {
        await parser.destroy();
      }
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        const result = await this.extractPdfText(messageId, part);
        if (result) {
          return result;
        }
      }
    }

    if (payload.mimeType === "text/plain" && payload.body?.data) {
      return Buffer.from(payload.body.data, "base64").toString("utf8");
    }

    return "";
  }
}
