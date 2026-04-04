import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AppConfig } from "./config/env.js";
import type { Logger } from "./utils/logger.js";
import { GmailPushHandler, type WorkflowRunner } from "./integrations/gmail/push-handler.js";
import {
  startMetricsServer
} from "./observability/metrics/prometheus.js";

export function startWebhookServer(
  config: AppConfig,
  logger: Logger,
  runWorkflow: WorkflowRunner
): void {
  if (config.metricsEnabled) {
    startMetricsServer(logger, config.metricsPort);
  }

  const handler = new GmailPushHandler(config, logger, runWorkflow);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    if (method === "POST" && pathname === "/pubsub/push") {
      await handler.handle(req, res);
      return;
    }

    if (method === "GET" && pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
      return;
    }

    res.writeHead(404).end("Not found");
  });

  server.listen(config.webhookPort, () => {
    logger.info("webhook-server-started", {
      port: config.webhookPort,
      pushEndpoint: "POST /pubsub/push",
      healthEndpoint: "GET /health"
    });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    logger.error("webhook-server-error", { message: err.message, code: err.code });
    process.exit(1);
  });

  const shutdown = (): void => {
    logger.info("webhook-server-shutting-down");
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
