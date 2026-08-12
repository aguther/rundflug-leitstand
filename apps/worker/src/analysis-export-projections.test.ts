import { describe, expect, it, vi } from "vitest";
import { pagedCsv } from "./analysis-export-projections";

async function collectText(source: AsyncGenerator<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  for await (const chunk of source) output += decoder.decode(chunk, { stream: true });
  return output + decoder.decode();
}

describe("analysis export projections", () => {
  it("preserves structured JSON values in CSV cells", async () => {
    const all = vi.fn(async () => ({
      results: [{ details: { reason: "weather", values: [1, 2] } }],
    }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));
    const database = { prepare } as unknown as D1Database;

    const csv = await collectText(
      pagedCsv({
        db: database,
        eventId: "synthetic-event",
        sql: "SELECT details FROM synthetic_analysis",
        columns: ["details"],
      }),
    );

    expect(csv).toBe('details\r\n"{""reason"":""weather"",""values"":[1,2]}"\r\n');
    expect(all).toHaveBeenCalledOnce();
  });
});
