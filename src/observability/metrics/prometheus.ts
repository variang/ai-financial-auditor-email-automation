import { createServer, type Server } from "node:http";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics
} from "prom-client";
import type { Logger } from "../../utils/logger.js";

const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "email_auditor_" });

const workflowRunsTotal = new Counter({
  name: "email_auditor_workflow_runs_total",
  help: "Total workflow runs by status.",
  labelNames: ["status"] as const,
  registers: [registry]
});

const workflowDurationSeconds = new Histogram({
  name: "email_auditor_workflow_duration_seconds",
  help: "Workflow execution duration in seconds.",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry]
});

const transactionsProcessedTotal = new Counter({
  name: "email_auditor_transactions_processed_total",
  help: "Total number of statement transactions processed.",
  registers: [registry]
});

const sheetsUpsertsTotal = new Counter({
  name: "email_auditor_sheet_upserts_total",
  help: "Total sheet tab upsert operations.",
  registers: [registry]
});

const repliesSentTotal = new Counter({
  name: "email_auditor_replies_sent_total",
  help: "Total automatic replies sent.",
  registers: [registry]
});

const workflowInFlight = new Gauge({
  name: "email_auditor_workflow_in_flight",
  help: "Current number of in-flight workflow runs.",
  registers: [registry]
});

export const metrics = {
  recordWorkflowStart(): number {
    workflowInFlight.inc();
    return Date.now();
  },
  recordWorkflowSuccess(startTimeMs: number): void {
    workflowRunsTotal.labels("success").inc();
    workflowDurationSeconds.observe((Date.now() - startTimeMs) / 1000);
    workflowInFlight.dec();
  },
  recordWorkflowFailure(startTimeMs: number): void {
    workflowRunsTotal.labels("failure").inc();
    workflowDurationSeconds.observe((Date.now() - startTimeMs) / 1000);
    workflowInFlight.dec();
  },
  addTransactions(count: number): void {
    transactionsProcessedTotal.inc(count);
  },
  recordSheetUpsert(): void {
    sheetsUpsertsTotal.inc();
  },
  recordReplySent(): void {
    repliesSentTotal.inc();
  }
};

export function getMetricsRegistry(): Registry {
  return registry;
}

export function startMetricsServer(logger: Logger, port: number): Server {
  const server = createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.statusCode = 200;
      res.setHeader("Content-Type", registry.contentType);
      res.end(await registry.metrics());
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  server.listen(port, () => {
    logger.info("metrics-server-started", { port, path: "/metrics" });
  });

  server.on("error", (error) => {
    logger.error("metrics-server-error", { message: error.message });
  });

  return server;
}
