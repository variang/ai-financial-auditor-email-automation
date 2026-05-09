import type { StatementTransaction } from "../../domain/types.js";
import type { Logger } from "../../utils/logger.js";
import type { LlmClient, LlmResponseSchema } from "./client.js";

const STATEMENT_RESPONSE_SCHEMA: LlmResponseSchema = {
  name: "statement_transactions",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["transactions", "parseErrors"],
    properties: {
      transactions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "merchant", "amount", "postedDateIso"],
          properties: {
            id: { type: "string" },
            merchant: { type: "string" },
            amount: { type: "number" },
            postedDateIso: { type: "string" }
          }
        }
      },
      parseErrors: {
        type: "array",
        items: { type: "string" }
      }
    }
  }
};

export interface ParseStatementInput {
  pdfText: string;
  cardNickname: string;
  statementDate: string;
}

export interface StatementParseResult {
  transactions: StatementTransaction[];
  parseErrors: string[];
}

export class StatementParser {
  constructor(
    private readonly llm: LlmClient,
    private readonly logger: Logger
  ) {}

  async parseStatementPdf(input: ParseStatementInput): Promise<StatementParseResult> {
    const { pdfText, cardNickname, statementDate } = input;
    const maxPdfLength = 8000;
    const truncatedPdfText = pdfText.substring(0, maxPdfLength);

    const instruction = `Extract all transactions from this credit card statement PDF text.
The response must conform to the provided JSON schema (statement_transactions).

Field rules:
- transactions[].id: deterministic identifier derived from merchant, amount, and date (e.g. concatenation or hash). Must be unique within the response.
- transactions[].merchant: trimmed merchant name as it appears on the statement.
- transactions[].amount: positive number (absolute value), even for credits/refunds.
- transactions[].postedDateIso: ISO-8601 timestamp with time 00:00:00Z. If the statement date cannot be parsed, fall back to "${statementDate}".
- Include all transactions on the statement, both purchases and credits.
- parseErrors: list any parsing warnings encountered; leave empty on a clean parse.

Statement context: card "${cardNickname}", statement date "${statementDate}".

Here is the statement text:
${truncatedPdfText}`;

    try {
      const response = await this.llm.generate({
        instruction,
        context: {
          cardNickname,
          statementDate,
          pdfTextLength: pdfText.length
        },
        responseSchema: STATEMENT_RESPONSE_SCHEMA
      });

      let jsonText = response.text;
      const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonText = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonText);
      const transactions = this.validateAndNormalizeTransactions(parsed, cardNickname, statementDate);
      const parseErrors = Array.isArray(parsed.parseErrors) ? parsed.parseErrors : [];

      this.logger.info("statement-parsed", {
        transactionCount: transactions.length,
        errorCount: parseErrors.length,
        cardNickname
      });

      return { transactions, parseErrors };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("statement-parse-failed", {
        message,
        cardNickname,
        statementDate
      });

      return {
        transactions: [],
        parseErrors: [message]
      };
    }
  }

  private validateAndNormalizeTransactions(
    parsed: { transactions?: unknown },
    cardNickname: string,
    statementDate: string
  ): StatementTransaction[] {
    if (!Array.isArray(parsed.transactions)) {
      throw new Error("LLM response missing transactions array");
    }

    return parsed.transactions.map((tx: Record<string, unknown>, index: number) => {
      if (typeof tx.merchant !== "string" || !tx.merchant.trim()) {
        throw new Error(`Transaction ${index} missing valid merchant name`);
      }
      if (typeof tx.amount !== "number" || tx.amount < 0) {
        throw new Error(`Transaction ${index} has invalid amount: ${tx.amount}`);
      }

      return {
        id: String(tx.id || `${cardNickname}-${index}-${Date.now()}`),
        cardNickname,
        merchant: tx.merchant.trim(),
        amount: Number(tx.amount),
        postedDateIso: String(tx.postedDateIso || statementDate),
        statementDate
      };
    });
  }
}
