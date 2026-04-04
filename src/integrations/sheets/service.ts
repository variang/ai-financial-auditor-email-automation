import type { SheetTabRequest } from "../../domain/types.js";
import { google, type sheets_v4 } from "googleapis";

export interface SheetsService {
  upsertTab(request: SheetTabRequest): Promise<{ tabName: string; sheetUrl: string }>;
}

const TRANSACTION_HEADERS = [
  "id",
  "merchant",
  "amount",
  "postedDateIso",
  "statementDate",
  "cardNickname"
] as const;

type TransactionHeader = (typeof TRANSACTION_HEADERS)[number];

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export class RealSheetsService implements SheetsService {
  private readonly client: sheets_v4.Sheets;

  constructor(credentialsPath: string) {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
    this.client = google.sheets({ version: "v4", auth });
  }

  async upsertTab(request: SheetTabRequest): Promise<{ tabName: string; sheetUrl: string }> {
    const sheetId = await this.ensureSheetExists(request.spreadsheetId, request.tabName);
    const quotedTabTitle = quoteSheetTitle(request.tabName);

    try {
      await this.client.spreadsheets.values.clear({
        spreadsheetId: request.spreadsheetId,
        range: `${quotedTabTitle}!A:Z`
      });

      const rows = request.rows.map((row) => {
        const normalized = row as Record<TransactionHeader, string | number | undefined>;
        return TRANSACTION_HEADERS.map((header) => normalized[header] ?? "");
      });

      await this.client.spreadsheets.values.update({
        spreadsheetId: request.spreadsheetId,
        range: `${quotedTabTitle}!A1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [Array.from(TRANSACTION_HEADERS), ...rows]
        }
      });
    } catch (error) {
      throw this.buildSheetsError(error, "Failed to write rows to spreadsheet tab");
    }

    return {
      tabName: request.tabName,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${request.spreadsheetId}/edit#gid=${sheetId}`
    };
  }

  private async ensureSheetExists(spreadsheetId: string, tabName: string): Promise<number> {
    let existingSheetId: number | undefined;

    try {
      const metadata = await this.client.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title))"
      });
      existingSheetId = metadata.data.sheets
        ?.find((sheet) => sheet.properties?.title === tabName)
        ?.properties?.sheetId ?? undefined;
    } catch (error) {
      throw this.buildSheetsError(error, "Failed to read spreadsheet metadata");
    }

    if (existingSheetId !== undefined) {
      return existingSheetId;
    }

    try {
      const response = await this.client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: tabName
                }
              }
            }
          ]
        }
      });

      const createdSheetId = response.data.replies?.[0]?.addSheet?.properties?.sheetId;
      if (createdSheetId == null) {
        throw new Error("Google Sheets API returned no sheetId for created tab");
      }

      return createdSheetId;
    } catch (error) {
      throw this.buildSheetsError(error, "Failed to create spreadsheet tab");
    }
  }

  private buildSheetsError(error: unknown, prefix: string): Error {
    const status =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : undefined;

    const message =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "unknown error";

    if (status === 403) {
      return new Error(`${prefix}: permission denied (403). ${message}`);
    }

    if (status === 404) {
      return new Error(`${prefix}: spreadsheet not found (404). ${message}`);
    }

    return new Error(`${prefix}: ${message}`);
  }
}

export class StubSheetsService implements SheetsService {
  async upsertTab(request: SheetTabRequest): Promise<{ tabName: string; sheetUrl: string }> {
    return {
      tabName: request.tabName,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${request.spreadsheetId}/edit#gid=0`
    };
  }
}
