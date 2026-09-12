import { describe, expect, it } from "bun:test";
import { parseCodeBuddyQuotaResponse } from "./codebuddy-cn.js";

describe("CodeBuddy quota parsing", () => {
  it("parses the flat CodeBuddy Inter account payload and labels packages", () => {
    const result = parseCodeBuddyQuotaResponse({
      code: 0,
      data: {
        Accounts: [
          {
            CapacitySize: "250",
            CapacityUsedPrecise: "108.84999999",
            CapacityRemainPrecise: "141.15000001",
            CycleStartTime: "2026-09-06 20:43:24",
            CycleEndTime: "2026-09-20 20:43:23",
            PackageCode: "TCACA_code_006_bonus",
          },
          {
            CapacitySize: "100",
            CapacityUsedPrecise: "0",
            CapacityRemainPrecise: "100",
            CycleStartTime: "2026-09-01 00:00:00",
            CycleEndTime: "2026-09-30 23:59:59",
            PackageCode: "TCACA_code_035_free",
          },
        ],
      },
    });

    expect(result.plan).toBe("CodeBuddy");
    expect(result.quotas["Bonus Pack"]).toMatchObject({
      used: 108.84999999,
      total: 250,
      recurring: false,
    });
    expect(result.quotas["Free Plan"]).toMatchObject({
      used: 0,
      total: 100,
      recurring: true,
    });
  });

  it("keeps the nested CN response compatible with recurring quota fields", () => {
    const result = parseCodeBuddyQuotaResponse({
      code: 0,
      data: {
        Response: {
          Data: {
            Accounts: [
              {
                PackageName: "CodeBuddy Pro",
                CycleCapacitySize: "100",
                CycleCapacityUsedPrecise: "25",
                CycleStartTime: "2026-09-01 00:00:00",
                CycleEndTime: "2026-10-01 00:00:00",
                DeductionEndTime: "2026-10-10T00:00:00Z",
              },
            ],
          },
        },
      },
    });

    expect(result.plan).toBe("CodeBuddy Pro");
    expect(result.quotas.Monthly).toMatchObject({
      used: 25,
      total: 100,
      recurring: true,
    });
  });
});
