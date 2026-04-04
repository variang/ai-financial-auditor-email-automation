import { loadConfig } from "./config/env.js";
import type { GmailPushEvent } from "./domain/types.js";
import type { WorkflowState } from "./workflow/state.js";
import { StubLlmClient } from "./integrations/llm/client.js";
import { StubReplyService } from "./integrations/reply/reply.js";
import { StubSheetsService } from "./integrations/sheets/service.js";
import { Logger } from "./utils/logger.js";
import { executeWorkflow } from "./workflow/graph.js";
import { metrics } from "./observability/metrics/prometheus.js";
import {
  LangSmithTracingAdapter,
  NoopTracingAdapter,
  type TracingAdapter
} from "./observability/langsmith/tracing.js";
import { startWebhookServer } from "./server.js";

// Builds a hardcoded sample state used for testing and local bootstrapping.
// Replace this with real Gmail History API fetching in the next iteration.
function buildSampleState(): WorkflowState {
  const now = new Date().toISOString();
  return {
    event: {
      messageId: "sample-message-001",
      threadId: "sample-thread-001",
      historyId: "sample-history-001",
      receivedAtIso: now
    },
    recipientEmail: "recipient@example.com",
    cardNickname: "Visa-1234",
    statementDate: "2026-04",
    transactions: [
      {
        id: "txn-1",
        cardNickname: "Visa-1234",
        merchant: "Coffee Shop",
        amount: 6.75,
        postedDateIso: now,
        statementDate: "2026-04"
      },
      {
        id: "txn-2",
        cardNickname: "Visa-1234",
        merchant: "Grocery",
        amount: 42.2,
        postedDateIso: now,
        statementDate: "2026-04"
      }
    ]
  };
}

// Converts a decoded GmailPushEvent into an initial WorkflowState skeleton.
// recipientEmail, cardNickname, statementDate, and transactions are placeholders
// until the Gmail History API fetch step is implemented.
export function buildInitialStateFromEvent(event: GmailPushEvent): WorkflowState {
  const statementDate = new Date().toISOString().slice(0, 7); // YYYY-MM
  return {
    event,
    recipientEmail: "unknown@placeholder.invalid",
    cardNickname: "Unknown-Card",
    statementDate,
    transactions: []
  };
}

// Creates a workflow runner function bound to the given config and stub services.
function createWorkflowRunner(config: AppConfig) {
  const tracing: TracingAdapter = config.langsmithTracing
    ? new LangSmithTracingAdapter(config.langsmithApiKey, config.langsmithProject)
    : new NoopTracingAdapter();

  return async (event: GmailPushEvent): Promise<void> => {
    const startTimeMs = metrics.recordWorkflowStart();
    try {
      await tracing.withTrace("financial-audit-workflow", () =>
        executeWorkflow(buildInitialStateFromEvent(event), config, {
          llm: new StubLlmClient(),
          sheets: new StubSheetsService(),
          reply: new StubReplyService()
        })
      );
      metrics.recordWorkflowSuccess(startTimeMs);
    } catch (error) {
      metrics.recordWorkflowFailure(startTimeMs);
      throw error;
    }
  };
}

import type { AppConfig } from "./config/env.js";

// bootstrap() is kept for tests — runs a single workflow pass with sample state.
export async function bootstrap(): Promise<WorkflowState> {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  const tracing: TracingAdapter = config.langsmithTracing
    ? new LangSmithTracingAdapter(config.langsmithApiKey, config.langsmithProject)
    : new NoopTracingAdapter();

  logger.info("bootstrapping-workflow", {
    runtime: config.runtime,
    gmailPubSubTopic: config.gmailPubSubTopic,
    ownerEmail: config.ownerEmail,
    autoReplyEnabled: config.autoReplyEnabled,
    metricsEnabled: config.metricsEnabled,
    metricsPort: config.metricsPort,
    llmProvider: config.llmProvider,
    llmModel: config.llmModel
  });

  const startTimeMs = metrics.recordWorkflowStart();
  let state: WorkflowState;
  try {
    state = await tracing.withTrace("financial-audit-workflow", async () =>
      executeWorkflow(buildSampleState(), config, {
        llm: new StubLlmClient(),
        sheets: new StubSheetsService(),
        reply: new StubReplyService()
      })
    );
    metrics.recordWorkflowSuccess(startTimeMs);
  } catch (error) {
    metrics.recordWorkflowFailure(startTimeMs);
    throw error;
  }

  logger.info("workflow-complete", {
    statementDate: state.statementDate,
    cardNickname: state.cardNickname,
    tabName: state.tabName,
    sheetUrl: state.sheetUrl,
    summary: state.summary
  });

  return state;
}

// CLI entrypoint: starts the long-running webhook server.
// Use `npm run simulate` in a separate terminal to send a test push event.
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  logger.info("starting-webhook-server", {
    runtime: config.runtime,
    webhookPort: config.webhookPort,
    metricsPort: config.metricsPort,
    ownerEmail: config.ownerEmail
  });

  startWebhookServer(config, logger, createWorkflowRunner(config));
}

