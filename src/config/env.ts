import { config } from "dotenv";
import { z } from "zod";
import type { RuntimeEnvironment } from "../domain/types.js";

config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_LOG_LEVEL: z.string().default("info"),
  GOOGLE_OWNER_EMAIL: z.email(),
  GOOGLE_SPREADSHEET_ID: z.string().min(1, "GOOGLE_SPREADSHEET_ID is required"),
  GOOGLE_CREDENTIALS_PATH: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional(),
  GMAIL_PUBSUB_TOPIC: z.string().min(1, "GMAIL_PUBSUB_TOPIC is required"),
  AUTO_REPLY_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),
  REPLY_SUMMARY_MAX_LINES: z
    .string()
    .default("4")
    .transform((v) => Number(v)),
  TAB_DATE_FORMAT: z.string().default("YYYY-MM"),
  LANGSMITH_TRACING: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("email-financial-auditor"),
  METRICS_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),
  METRICS_PORT: z
    .string()
    .default("9464")
    .transform((v) => Number(v)),
  WEBHOOK_PORT: z
    .string()
    .default("8080")
    .transform((v) => Number(v)),
  PUBSUB_VERIFICATION_TOKEN: z.string().optional(),
  LLM_PROVIDER: z.string().default("copilot"),
  LLM_MODEL: z.string().default("placeholder-model")
}).superRefine((data, ctx) => {
  if (data.NODE_ENV !== "test" && !data.GOOGLE_CREDENTIALS_PATH) {
    ctx.addIssue({
      code: "custom",
      path: ["GOOGLE_CREDENTIALS_PATH"],
      message: "GOOGLE_CREDENTIALS_PATH is required when NODE_ENV is not test"
    });
  }

  const oauthFields = [
    data.GOOGLE_OAUTH_CLIENT_ID,
    data.GOOGLE_OAUTH_CLIENT_SECRET,
    data.GOOGLE_OAUTH_REFRESH_TOKEN
  ];
  const hasAnyOauthField = oauthFields.some((value) => value !== undefined);
  const hasAllOauthFields = oauthFields.every((value) => value !== undefined);

  if (hasAnyOauthField && !hasAllOauthFields) {
    ctx.addIssue({
      code: "custom",
      path: ["GOOGLE_OAUTH_CLIENT_ID"],
      message:
        "GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN must all be set together"
    });
  }
});

export type AppConfig = {
  runtime: RuntimeEnvironment;
  logLevel: string;
  ownerEmail: string;
  spreadsheetId: string;
  googleCredentialsPath?: string;
  googleOauthClientId?: string;
  googleOauthClientSecret?: string;
  googleOauthRefreshToken?: string;
  gmailPubSubTopic: string;
  autoReplyEnabled: boolean;
  replySummaryMaxLines: number;
  tabDateFormat: string;
  langsmithTracing: boolean;
  langsmithApiKey?: string;
  langsmithProject: string;
  metricsEnabled: boolean;
  metricsPort: number;
  webhookPort: number;
  pubSubVerificationToken?: string;
  llmProvider: string;
  llmModel: string;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return {
    runtime: parsed.data.NODE_ENV,
    logLevel: parsed.data.APP_LOG_LEVEL,
    ownerEmail: parsed.data.GOOGLE_OWNER_EMAIL,
    spreadsheetId: parsed.data.GOOGLE_SPREADSHEET_ID,
    googleCredentialsPath: parsed.data.GOOGLE_CREDENTIALS_PATH,
    googleOauthClientId: parsed.data.GOOGLE_OAUTH_CLIENT_ID,
    googleOauthClientSecret: parsed.data.GOOGLE_OAUTH_CLIENT_SECRET,
    googleOauthRefreshToken: parsed.data.GOOGLE_OAUTH_REFRESH_TOKEN,
    gmailPubSubTopic: parsed.data.GMAIL_PUBSUB_TOPIC,
    autoReplyEnabled: parsed.data.AUTO_REPLY_ENABLED,
    replySummaryMaxLines: parsed.data.REPLY_SUMMARY_MAX_LINES,
    tabDateFormat: parsed.data.TAB_DATE_FORMAT,
    langsmithTracing: parsed.data.LANGSMITH_TRACING,
    langsmithApiKey: parsed.data.LANGSMITH_API_KEY,
    langsmithProject: parsed.data.LANGSMITH_PROJECT,
    metricsEnabled: parsed.data.METRICS_ENABLED,
    metricsPort: parsed.data.METRICS_PORT,
    webhookPort: parsed.data.WEBHOOK_PORT,
    pubSubVerificationToken: parsed.data.PUBSUB_VERIFICATION_TOKEN,
    llmProvider: parsed.data.LLM_PROVIDER,
    llmModel: parsed.data.LLM_MODEL
  };
}
