import type { SheetTabRequest } from "../../domain/types.js";

export interface SheetsService {
  upsertTab(request: SheetTabRequest): Promise<{ tabName: string; sheetUrl: string }>;
}

export class StubSheetsService implements SheetsService {
  async upsertTab(request: SheetTabRequest): Promise<{ tabName: string; sheetUrl: string }> {
    return {
      tabName: request.tabName,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${request.spreadsheetId}/edit#gid=0`
    };
  }
}
