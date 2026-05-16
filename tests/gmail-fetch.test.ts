import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../src/utils/logger.js";
import {
  StubGmailFetchService,
  type GmailFetchService
} from "../src/integrations/gmail/client.js";

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  } as unknown as Logger;
}

describe("GmailFetchService", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe("StubGmailFetchService", () => {
    it("returns hardcoded sample data on fetch", async () => {
      const service: GmailFetchService = new StubGmailFetchService();

      const result = await service.fetch({
        historyId: "123456",
        emailAddress: "test@example.com"
      });

      expect(result.pdfText).toContain("Credit Card Statement");
      expect(result.pdfText).toContain("Coffee Shop");
      expect(result.pdfText).toContain("$6.75");
      expect(result.recipientEmail).toBe("recipient@example.com");
      expect(result.cardNickname).toBe("Visa-1234");
      expect(result.threadId).toBe("sample-thread-001");
    });

    it("returns consistent data across multiple calls", async () => {
      const service: GmailFetchService = new StubGmailFetchService();

      const result1 = await service.fetch({
        historyId: "111",
        emailAddress: "test1@example.com"
      });

      const result2 = await service.fetch({
        historyId: "222",
        emailAddress: "test2@example.com"
      });

      expect(result1.pdfText).toBe(result2.pdfText);
      expect(result1.recipientEmail).toBe(result2.recipientEmail);
      expect(result1.cardNickname).toBe(result2.cardNickname);
    });

    it("includes required transaction data in PDF text", async () => {
      const service: GmailFetchService = new StubGmailFetchService();

      const result = await service.fetch({
        historyId: "123",
        emailAddress: "test@example.com"
      });

      // Verify the PDF contains transaction data that the parser can work with
      expect(result.pdfText).toContain("04/05/26");
      expect(result.pdfText).toContain("Whole Foods");
      expect(result.pdfText).toContain("Gas Station");
      expect(result.pdfText).toContain("Restaurant");
    });
  });
});
