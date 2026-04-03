import { loadConfig } from "./config/env.js";
import type { WorkflowState } from "./workflow/state.js";
import { StubLlmClient } from "./integrations/llm/client.js";
import { StubReplyService } from "./integrations/reply/reply.js";
import { StubSheetsService } from "./integrations/sheets/service.js";
import { Logger } from "./utils/logger.js";
import { executeWorkflow } from "./workflow/graph.js";
import {
  metrics,
  startMetricsServer
} from "./observability/metrics/prometheus.js";
import {
  LangSmithTracingAdapter,
  NoopTracingAdapter,
  type TracingAdapter
} from "./observability/langsmith/tracing.js";

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

export async function bootstrap(): Promise<WorkflowState> {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  if (config.metricsEnabled && config.runtime !== "test") {
    startMetricsServer(logger, config.metricsPort);
  }

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

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrap().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const logger = new Logger("error");
    logger.error("bootstrap-failed", { message });
    process.exit(1);
  });
}
