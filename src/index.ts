import { loadConfig } from "./config/env.js";
import type { AppConfig } from "./config/env.js";
import type { GmailPushEvent } from "./domain/types.js";
import type { WorkflowState } from "./workflow/state.js";
import { OpenAiLlmClient, StubLlmClient } from "./integrations/llm/client.js";
import { StatementParser } from "./integrations/llm/statement-parser.js";
import {
  RealGmailReplyService,
  StubReplyService,
  type ReplyService
} from "./integrations/reply/reply.js";
import {
  RealSheetsService,
  StubSheetsService,
  type SheetsService
} from "./integrations/sheets/service.js";
import { Logger } from "./utils/logger.js";
import { executeWorkflow } from "./workflow/graph.js";
import { metrics } from "./observability/metrics/prometheus.js";
import {
  LangSmithTracingAdapter,
  NoopTracingAdapter,
  type TracingAdapter
} from "./observability/langsmith/tracing.js";
import { startWebhookServer } from "./server.js";

function createSheetsService(config: AppConfig): SheetsService {
  if (config.runtime === "test") {
    return new StubSheetsService();
  }

  if (!config.googleCredentialsPath) {
    throw new Error("GOOGLE_CREDENTIALS_PATH is required for real Sheets integration");
  }

  return new RealSheetsService(config.googleCredentialsPath);
}

function createReplyService(config: AppConfig): ReplyService {
  if (config.runtime === "test") {
    return new StubReplyService();
  }

  if (
    config.googleOauthClientId &&
    config.googleOauthClientSecret &&
    config.googleOauthRefreshToken
  ) {
    return new RealGmailReplyService({
      kind: "oauth",
      clientId: config.googleOauthClientId,
      clientSecret: config.googleOauthClientSecret,
      refreshToken: config.googleOauthRefreshToken
    });
  }

  if (!config.googleCredentialsPath) {
    throw new Error(
      "Gmail integration requires either GOOGLE_OAUTH_* credentials or GOOGLE_CREDENTIALS_PATH"
    );
  }

  return new RealGmailReplyService({
    kind: "service-account",
    credentialsPath: config.googleCredentialsPath
  });
}

function createLlmClient(config: AppConfig, logger: Logger) {
  if (config.runtime === "test") {
    return new StubLlmClient();
  }

  if (config.llmProvider === "copilot") {
    return new OpenAiLlmClient(config, logger);
  }

  logger.warn("llm-provider-unknown", { provider: config.llmProvider });
  return new StubLlmClient();
}

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

export function buildInitialStateFromEvent(event: GmailPushEvent, config: AppConfig): WorkflowState {
  const statementDate = new Date().toISOString().slice(0, 7); // YYYY-MM
  return {
    event,
    recipientEmail: config.placeholderRecipientEmail,
    cardNickname: config.placeholderCardNickname,
    statementDate,
    transactions: []
  };
}

function createWorkflowRunner(config: AppConfig, logger: Logger) {
  const tracing: TracingAdapter = config.langsmithTracing
    ? new LangSmithTracingAdapter(config.langsmithApiKey, config.langsmithProject)
    : new NoopTracingAdapter();
  const sheets = createSheetsService(config);
  const reply = createReplyService(config);
  const llm = createLlmClient(config, logger);
  const parser = new StatementParser(llm, logger);

  return async (event: GmailPushEvent): Promise<void> => {
    const startTimeMs = metrics.recordWorkflowStart();
    try {
      await tracing.withTrace("financial-audit-workflow", () =>
        executeWorkflow(buildInitialStateFromEvent(event, config), config, {
          llm,
          parser,
          sheets,
          reply
        })
      );
      metrics.recordWorkflowSuccess(startTimeMs);
    } catch (error) {
      metrics.recordWorkflowFailure(startTimeMs);
      throw error;
    }
  };
}

// bootstrap() is kept for tests — runs a single workflow pass with sample state.
export async function bootstrap(): Promise<WorkflowState> {
  const config = loadConfig();
  const logger = new Logger(config.logLevel);

  const tracing: TracingAdapter = config.langsmithTracing
    ? new LangSmithTracingAdapter(config.langsmithApiKey, config.langsmithProject)
    : new NoopTracingAdapter();
  const sheets = createSheetsService(config);
  const reply = createReplyService(config);
  const llm = createLlmClient(config, logger);
  const parser = new StatementParser(llm, logger);

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
        llm,
        parser,
        sheets,
        reply
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

  startWebhookServer(config, logger, createWorkflowRunner(config, logger));
}
