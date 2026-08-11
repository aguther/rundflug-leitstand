import { describe, expect, it, vi } from "vitest";
import {
  allocatePublicSaleCodes,
  createPublicStatusCode,
  PublicCodeAllocationError,
} from "./public-code-service";

function collisionDatabase(collisions: number[]): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({ public_code_exists: collisions.shift() ?? 0 })),
      })),
    })),
  } as unknown as D1Database;
}

describe("public code allocation", () => {
  it("creates an 80-bit non-ambiguous code from 128 worker-random input bits", () => {
    const code = createPublicStatusCode((bytes) => {
      bytes.forEach((_, index) => {
        bytes[index] = index;
      });
      return bytes;
    });

    expect(code).toBe("ABCDEFGHJKLMNPQR");
    expect(code).toMatch(/^[A-Z2-9]{16}$/);
  });

  it("retries a persisted collision and keeps group and ticket codes distinct", async () => {
    const database = collisionDatabase([1, 0]);
    const candidates = [
      "AAAAAAAAAAAAAAAA",
      "BBBBBBBBBBBBBBBB",
      "CCCCCCCCCCCCCCCC",
      "DDDDDDDDDDDDDDDD",
      "EEEEEEEEEEEEEEEE",
      "FFFFFFFFFFFFFFFF",
    ];

    const allocated = await allocatePublicSaleCodes(database, 2, () => candidates.shift() ?? "");

    expect(allocated.groupCode).toBe("DDDDDDDDDDDDDDDD");
    expect(allocated.ticketCodes).toEqual(["EEEEEEEEEEEEEEEE", "FFFFFFFFFFFFFFFF"]);
    expect(new Set([allocated.groupCode, ...allocated.ticketCodes]).size).toBe(3);
    expect(database.prepare).toHaveBeenCalledTimes(2);
  });

  it("fails closed when every candidate batch collides internally", async () => {
    await expect(
      allocatePublicSaleCodes(collisionDatabase([]), 1, () => "AAAAAAAAAAAAAAAA"),
    ).rejects.toBeInstanceOf(PublicCodeAllocationError);
  });
});
