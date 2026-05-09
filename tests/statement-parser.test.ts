import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmClient, LlmGenerateInput } from "../src/integrations/llm/client.js";
import type { Logger } from "../src/utils/logger.js";
import { StatementParser } from "../src/integrations/llm/statement-parser.js";

function makeLlmClient(responseText: string): LlmClient {
  return {
    generate: vi.fn().mockResolvedValue({ text: responseText })
  };
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  } as unknown as Logger;
}

const VALID_RESPONSE = JSON.stringify({
  transactions: [
    {
      id: "txn-001",
      cardNickname: "Visa-1234",
      merchant: "Coffee Shop",
      amount: 6.75,
      postedDateIso: "2026-04-01T00:00:00Z",
      statementDate: "2026-04"
    },
    {
      id: "txn-002",
      cardNickname: "Visa-1234",
      merchant: "Supermarket",
      amount: 45.20,
      postedDateIso: "2026-04-03T00:00:00Z",
      statementDate: "2026-04"
    }
  ],
  parseErrors: []
});

const BASE_INPUT = {
  pdfText: "Sample PDF text with transactions",
  cardNickname: "Visa-1234",
  statementDate: "2026-04"
};

describe("StatementParser.parseStatementPdf", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("parses valid LLM JSON response into transactions", async () => {
    const llm = makeLlmClient(VALID_RESPONSE);
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions).toHaveLength(2);
    expect(result.parseErrors).toHaveLength(0);

    const [first, second] = result.transactions;
    expect(first.id).toBe("txn-001");
    expect(first.merchant).toBe("Coffee Shop");
    expect(first.amount).toBe(6.75);
    expect(first.postedDateIso).toBe("2026-04-01T00:00:00Z");
    expect(first.cardNickname).toBe("Visa-1234");
    expect(first.statementDate).toBe("2026-04");

    expect(second.merchant).toBe("Supermarket");
    expect(second.amount).toBe(45.20);
  });

  it("parses LLM response wrapped in markdown code fences", async () => {
    const wrapped = "```json\n" + VALID_RESPONSE + "\n```";
    const llm = makeLlmClient(wrapped);
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions).toHaveLength(2);
    expect(result.parseErrors).toHaveLength(0);
  });

  it("parses LLM response wrapped in plain code fences", async () => {
    const wrapped = "```\n" + VALID_RESPONSE + "\n```";
    const llm = makeLlmClient(wrapped);
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions).toHaveLength(2);
  });

  it("includes parse errors from LLM response", async () => {
    const responseWithErrors = JSON.stringify({
      transactions: [
        {
          id: "txn-001",
          cardNickname: "Visa-1234",
          merchant: "Gas Station",
          amount: 55.00,
          postedDateIso: "2026-04-05T00:00:00Z",
          statementDate: "2026-04"
        }
      ],
      parseErrors: ["Could not parse date for transaction on page 2"]
    });
    const llm = makeLlmClient(responseWithErrors);
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions).toHaveLength(1);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0]).toContain("Could not parse date");
  });

  it("uses cardNickname from input, not from LLM response", async () => {
    const responseWithDifferentCard = JSON.stringify({
      transactions: [
        {
          id: "txn-001",
          cardNickname: "SomethingElse",
          merchant: "Restaurant",
          amount: 30.00,
          postedDateIso: "2026-04-10T00:00:00Z",
          statementDate: "2026-04"
        }
      ],
      parseErrors: []
    });
    const llm = makeLlmClient(responseWithDifferentCard);
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions[0].cardNickname).toBe("Visa-1234");
  });

  it("uses statementDate as fallback for missing postedDateIso", async () => {
    const responseNoDate = JSON.stringify({
      transactions: [
        {
          id: "txn-001",
          cardNickname: "Visa-1234",
          merchant: "Bookstore",
          amount: 12.00,
          postedDateIso: null,
          statementDate: "2026-04"
        }
      ],
      parseErrors: []
    });
    const llm = makeLlmClient(responseNoDate);
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions[0].postedDateIso).toBe("2026-04");
  });

  it("generates a fallback id when LLM omits id field", async () => {
    const responseNoId = JSON.stringify({
      transactions: [
        {
          cardNickname: "Visa-1234",
          merchant: "Pharmacy",
          amount: 20.00,
          postedDateIso: "2026-04-15T00:00:00Z",
          statementDate: "2026-04"
        }
      ],
      parseErrors: []
    });
    const llm = makeLlmClient(responseNoId);
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions[0].id).toBeTruthy();
    expect(typeof result.transactions[0].id).toBe("string");
  });

  it("trims whitespace from merchant names", async () => {
    const responseWithWhitespace = JSON.stringify({
      transactions: [
        {
          id: "txn-001",
          cardNickname: "Visa-1234",
          merchant: "  Online Store  ",
          amount: 99.99,
          postedDateIso: "2026-04-20T00:00:00Z",
          statementDate: "2026-04"
        }
      ],
      parseErrors: []
    });
    const llm = makeLlmClient(responseWithWhitespace);
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions[0].merchant).toBe("Online Store");
  });

  it("truncates pdfText to 8000 characters before sending to LLM", async () => {
    const llm = makeLlmClient(VALID_RESPONSE);
    const parser = new StatementParser(llm, logger);

    const longText = "A".repeat(20000);
    await parser.parseStatementPdf({ ...BASE_INPUT, pdfText: longText });

    const call = vi.mocked(llm.generate).mock.calls[0][0] as LlmGenerateInput;
    expect(call.instruction).toContain("A".repeat(8000));
    expect(call.instruction).not.toContain("A".repeat(8001));
  });

  it("returns empty transactions and error on invalid JSON from LLM", async () => {
    const llm = makeLlmClient("this is not JSON at all");
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions).toHaveLength(0);
    expect(result.parseErrors).toHaveLength(1);
  });

  it("returns empty transactions and error when LLM response lacks transactions array", async () => {
    const llm = makeLlmClient(JSON.stringify({ parseErrors: [] }));
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions).toHaveLength(0);
    expect(result.parseErrors[0]).toMatch(/transactions array/);
  });

  it("throws and returns error when a transaction has missing merchant", async () => {
    const responseNoMerchant = JSON.stringify({
      transactions: [
        {
          id: "txn-001",
          cardNickname: "Visa-1234",
          merchant: "",
          amount: 10.00,
          postedDateIso: "2026-04-01T00:00:00Z",
          statementDate: "2026-04"
        }
      ],
      parseErrors: []
    });
    const llm = makeLlmClient(responseNoMerchant);
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions).toHaveLength(0);
    expect(result.parseErrors[0]).toMatch(/merchant/);
  });

  it("returns error when a transaction has negative amount", async () => {
    const responseNegative = JSON.stringify({
      transactions: [
        {
          id: "txn-001",
          cardNickname: "Visa-1234",
          merchant: "Refund Shop",
          amount: -5.00,
          postedDateIso: "2026-04-01T00:00:00Z",
          statementDate: "2026-04"
        }
      ],
      parseErrors: []
    });
    const llm = makeLlmClient(responseNegative);
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions).toHaveLength(0);
    expect(result.parseErrors[0]).toMatch(/invalid amount/i);
  });

  it("returns error when LLM generate rejects", async () => {
    const llm: LlmClient = {
      generate: vi.fn().mockRejectedValue(new Error("LLM network failure"))
    };
    const parser = new StatementParser(llm, logger);

    const result = await parser.parseStatementPdf(BASE_INPUT);

    expect(result.transactions).toHaveLength(0);
    expect(result.parseErrors[0]).toBe("LLM network failure");
  });

  it("logs info on successful parse", async () => {
    const llm = makeLlmClient(VALID_RESPONSE);
    const parser = new StatementParser(llm, logger);

    await parser.parseStatementPdf(BASE_INPUT);

    expect(logger.info).toHaveBeenCalledWith("statement-parsed", expect.objectContaining({
      transactionCount: 2,
      errorCount: 0,
      cardNickname: "Visa-1234"
    }));
  });

  it("logs error on failed parse", async () => {
    const llm = makeLlmClient("not json");
    const parser = new StatementParser(llm, logger);

    await parser.parseStatementPdf(BASE_INPUT);

    expect(logger.error).toHaveBeenCalledWith("statement-parse-failed", expect.objectContaining({
      cardNickname: "Visa-1234",
      statementDate: "2026-04"
    }));
  });
});
