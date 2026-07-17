import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./crypto";

describe("operator PIN hashing", () => {
  it("uses the Cloudflare-supported PBKDF2 work factor", async () => {
    const encoded = await hashPin("123456");

    expect(encoded.split("$")[1]).toBe("100000");
    await expect(verifyPin("123456", encoded)).resolves.toBe(true);
    await expect(verifyPin("654321", encoded)).resolves.toBe(false);
  });

  it("rejects unsupported imported work factors without invoking PBKDF2", async () => {
    await expect(verifyPin("123456", "pbkdf2-sha256$210000$c2FsdA$ZGVyaXZlZA")).resolves.toBe(
      false,
    );
  });
});
