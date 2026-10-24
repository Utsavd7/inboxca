import { describe, expect, it } from "vitest";
import { activeClients, matchClient, planImport } from "@/src/lib/first-import";

// Folders as a firm keeps them before InboxCA, and where the first import would put each file.
const clients = [
  { id: "patel", name: "Patel Textiles Pvt Ltd" },
  { id: "shah", name: "Shah & Sons" },
  { id: "desai", name: "Desai" },
];
const files = [
  { id: "1", path: "Clients/Patel Textiles/2025-26/GST/GSTR-3B Mar 2026.pdf", size: 10 },
  { id: "2", path: "Clients/Patel Textiles/2025-26/GST/purchase register.xlsx", size: 20 },
  { id: "3", path: "Clients/SHAH AND SONS/ITR/ITR-V AY 2025-26.pdf", size: 30 },
  { id: "4", path: "Clients/Unknown Traders/notice.pdf", size: 40 },
];

describe("the first import", () => {
  it("finds the client from the folder names, whatever the company ending or case", () => {
    expect(matchClient(files[0].path, clients)).toEqual({ id: "patel", folder: "Clients/Patel Textiles" });
    expect(matchClient(files[2].path, clients)).toEqual({ id: "shah", folder: "Clients/SHAH AND SONS" });
    expect(matchClient(files[3].path, clients)).toBeNull();
  });
  it("brings final papers only by default, with their type, work and period", () => {
    expect(planImport(files, clients, "final", "", "2026-10-18").map(({ id, client, type, work, period }) => ({ id, client, type, work, period }))).toEqual([
      { id: "1", client: "patel", type: "GSTR-3B", work: "gst", period: "2026-03" },
      { id: "3", client: "shah", type: "ITR-V", work: "income_tax", period: "2025" },
      { id: "4", client: null, type: "Notice", work: "other", period: "" },
    ]);
  });
  it("takes one year in full, and a client the owner chose for a folder that did not match", () => {
    const planned = planImport(files, clients, "year", "FY 2025-26", "2026-10-18", { "Clients/Unknown Traders": "desai" });
    // The ITR-V is for AY 2025-26, so FY 2024-25.
    expect(planned.map((file) => file.id)).toEqual(["1", "2"]);
    expect(planImport(files, clients, "all", "", "2026-10-18", { "Clients/Unknown Traders": "desai" }).find((file) => file.id === "4")?.client).toBe("desai");
  });
  it("matches against every client, past the 1,000 rows one request returns", async () => {
    const firm = Array.from({ length: 2500 }, (_, at) => ({ id: String(at), name: `Client ${at}` }));
    const query = { select: () => query, is: () => query, order: () => query, range: async (from: number, to: number) => ({ data: firm.slice(from, Math.min(to + 1, from + 1000)) }) };
    const all = await activeClients({ from: () => query } as unknown as Parameters<typeof activeClients>[0]);
    expect(all).toHaveLength(2500);
    expect(matchClient("Clients/Client 2499/notice.pdf", all)?.id).toBe("2499");
  });
});
