import { describe, expect, it } from "vitest";
import { bootstrap } from "../src/index.js";
import { loadConfig } from "../src/config/env.js";

describe("config", () => {
  it("fails when required environment fields are missing", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test"
      })
    ).toThrowError(/Invalid environment configuration/);
  });
});

describe("bootstrap", () => {
  it("produces summary and sheet metadata", async () => {
    process.env.NODE_ENV = "test";
    process.env.APP_LOG_LEVEL = "error";
    process.env.GOOGLE_OWNER_EMAIL = "vari.ang98@gmail.com";
    process.env.GOOGLE_SPREADSHEET_ID = "sheet123";
    process.env.GMAIL_PUBSUB_TOPIC = "projects/test/topics/gmail-watch";
    process.env.AUTO_REPLY_ENABLED = "true";
    process.env.REPLY_SUMMARY_MAX_LINES = "4";
    process.env.TAB_DATE_FORMAT = "YYYY-MM";
    process.env.LANGSMITH_TRACING = "false";
    process.env.LANGSMITH_PROJECT = "test-project";
    process.env.METRICS_ENABLED = "true";
    process.env.METRICS_PORT = "9464";
    process.env.WEBHOOK_PORT = "8080";
    process.env.LLM_PROVIDER = "copilot";
    process.env.LLM_MODEL = "placeholder-model";

    const state = await bootstrap();

    expect(state.sheetUrl).toContain("https://docs.google.com/spreadsheets/d/sheet123");
    expect(state.tabName).toBe("2026-04_Visa-1234");
    expect(state.reply?.auditSummaryLines.length).toBe(4);
  });
});
