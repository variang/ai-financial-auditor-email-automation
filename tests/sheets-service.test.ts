import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const get = vi.fn();
  const batchUpdate = vi.fn();
  const clear = vi.fn();
  const update = vi.fn();
  const sheetsFactory = vi.fn();

  return {
    get,
    batchUpdate,
    clear,
    update,
    sheetsFactory
  };
});

vi.mock("googleapis", () => {
  class GoogleAuth {
    constructor(_options: unknown) {
      // no-op for tests
    }
  }

  return {
    google: {
      auth: {
        GoogleAuth
      },
      sheets: mocks.sheetsFactory
    }
  };
});

import {
  RealSheetsService,
  StubSheetsService
} from "../src/integrations/sheets/service.js";

describe("RealSheetsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.sheetsFactory.mockReturnValue({
      spreadsheets: {
        get: mocks.get,
        batchUpdate: mocks.batchUpdate,
        values: {
          clear: mocks.clear,
          update: mocks.update
        }
      }
    });

    mocks.get.mockResolvedValue({
      data: {
        sheets: [
          {
            properties: {
              title: "2026-04_Visa-1234",
              sheetId: 321
            }
          }
        ]
      }
    });

    mocks.clear.mockResolvedValue({});
    mocks.update.mockResolvedValue({});
    mocks.batchUpdate.mockResolvedValue({
      data: {
        replies: [
          {
            addSheet: {
              properties: {
                sheetId: 999
              }
            }
          }
        ]
      }
    });
  });

  it("writes header and rows to an existing tab", async () => {
    const service = new RealSheetsService("/tmp/fake-credentials.json");

    const result = await service.upsertTab({
      spreadsheetId: "sheet123",
      ownerEmail: "owner@example.com",
      tabName: "2026-04_Visa-1234",
      rows: [
        {
          id: "txn-1",
          merchant: "Coffee Shop",
          amount: 6.75,
          postedDateIso: "2026-04-01T00:00:00.000Z",
          statementDate: "2026-04",
          cardNickname: "Visa-1234"
        }
      ]
    });

    expect(mocks.batchUpdate).not.toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalledWith({
      spreadsheetId: "sheet123",
      range: "'2026-04_Visa-1234'!A:Z"
    });
    expect(mocks.update).toHaveBeenCalledWith({
      spreadsheetId: "sheet123",
      range: "'2026-04_Visa-1234'!A1",
      valueInputOption: "RAW",
      requestBody: {
        values: [
          [
            "id",
            "merchant",
            "amount",
            "postedDateIso",
            "statementDate",
            "cardNickname"
          ],
          [
            "txn-1",
            "Coffee Shop",
            6.75,
            "2026-04-01T00:00:00.000Z",
            "2026-04",
            "Visa-1234"
          ]
        ]
      }
    });

    expect(result).toEqual({
      tabName: "2026-04_Visa-1234",
      sheetUrl: "https://docs.google.com/spreadsheets/d/sheet123/edit#gid=321"
    });
  });

  it("creates tab when missing and returns created gid", async () => {
    mocks.get.mockResolvedValueOnce({ data: { sheets: [] } });

    const service = new RealSheetsService("/tmp/fake-credentials.json");

    const result = await service.upsertTab({
      spreadsheetId: "sheet456",
      ownerEmail: "owner@example.com",
      tabName: "2026-04_Mastercard",
      rows: []
    });

    expect(mocks.batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet456",
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: "2026-04_Mastercard"
              }
            }
          }
        ]
      }
    });
    expect(mocks.clear).toHaveBeenCalledWith({
      spreadsheetId: "sheet456",
      range: "'2026-04_Mastercard'!A:Z"
    });
    expect(result.sheetUrl).toBe(
      "https://docs.google.com/spreadsheets/d/sheet456/edit#gid=999"
    );
  });

  it("maps 403 errors to permission denied message", async () => {
    mocks.get.mockRejectedValueOnce({
      status: 403,
      message: "The caller does not have permission"
    });

    const service = new RealSheetsService("/tmp/fake-credentials.json");

    await expect(
      service.upsertTab({
        spreadsheetId: "sheet789",
        ownerEmail: "owner@example.com",
        tabName: "2026-04_Amex",
        rows: []
      })
    ).rejects.toThrow(/permission denied \(403\)/i);
  });
});

describe("StubSheetsService", () => {
  it("returns deterministic sheet url", async () => {
    const service = new StubSheetsService();

    const result = await service.upsertTab({
      spreadsheetId: "sheet000",
      ownerEmail: "owner@example.com",
      tabName: "tab-a",
      rows: []
    });

    expect(result).toEqual({
      tabName: "tab-a",
      sheetUrl: "https://docs.google.com/spreadsheets/d/sheet000/edit#gid=0"
    });
  });
});
