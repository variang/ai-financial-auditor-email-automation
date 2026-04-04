import type { IncomingMessage, ServerResponse } from "node:http";
import type { GmailPushEvent } from "../../domain/types.js";
import type { AppConfig } from "../../config/env.js";
import type { Logger } from "../../utils/logger.js";
import { GmailPushDecoder } from "./trigger.js";

export type WorkflowRunner = (event: GmailPushEvent) => Promise<void>;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export class GmailPushHandler {
  private readonly decoder = new GmailPushDecoder();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly runWorkflow: WorkflowRunner
  ) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Verify optional push verification token.
    // Configure the Pub/Sub subscription endpoint as:
    //   https://yourapp.com/pubsub/push?token=<PUBSUB_VERIFICATION_TOKEN>
    if (this.config.pubSubVerificationToken) {
      const url = new URL(req.url ?? "/", "http://localhost");
      const token = url.searchParams.get("token");
      if (token !== this.config.pubSubVerificationToken) {
        this.logger.warn("push-handler-token-rejected", { url: req.url });
        res.writeHead(401).end("Unauthorized");
        return;
      }
    }

    const rawBody = await readBody(req);

    let event: GmailPushEvent;
    try {
      event = this.decoder.decodePushEvent(rawBody);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn("push-handler-decode-failed", { message });
      // 400 tells Pub/Sub this payload will never be valid — don't retry it.
      res.writeHead(400).end(message);
      return;
    }

    this.logger.info("push-handler-event-received", {
      messageId: event.messageId,
      historyId: event.historyId,
      receivedAtIso: event.receivedAtIso
    });

    // Acknowledge immediately with 204 so Pub/Sub does not retry.
    // The workflow runs asynchronously; we own retry and error handling internally.
    res.writeHead(204).end();

    try {
      await this.runWorkflow(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("push-handler-workflow-failed", {
        message,
        messageId: event.messageId
      });
    }
  }
}
