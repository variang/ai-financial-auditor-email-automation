import type { StatementTransaction } from "../../domain/types.js";
import type { Logger } from "../../utils/logger.js";
import type { LlmClient } from "./client.js";

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
Return a JSON object with two fields:
{
  "transactions": [
    {
      "id": "unique_id",
      "cardNickname": "${cardNickname}",
      "merchant": "merchant name",
      "amount": 123.45,
      "postedDateIso": "2026-04-15T00:00:00Z",
      "statementDate": "${statementDate}"
    }
  ],
  "parseErrors": ["list of any parsing errors or warnings"]
}

Rules:
- Extract transaction amounts as positive numbers (absolute values)
- Parse dates in the statement and convert to ISO format with time 00:00:00Z
- If a date cannot be parsed, use the statement date
- Id should be deterministic based on merchant, amount, and date (e.g. hash or concatenation)
- Include all transactions, both purchases and credits
- parseErrors should be empty if parsing is successful

Here is the statement text:
${truncatedPdfText}`;

    try {
      const response = await this.llm.generate({
        instruction,
        context: {
          cardNickname,
          statementDate,
          pdfTextLength: pdfText.length
        }
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
