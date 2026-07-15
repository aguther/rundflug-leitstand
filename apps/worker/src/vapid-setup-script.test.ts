import { describe, expect, it } from "vitest";
// @ts-expect-error The operational Node script deliberately has no production TypeScript surface.
import { generateVapidKeyPair, validateVapidSubject } from "../../../scripts/vapid-keys.mjs";

const decodeBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (entry) =>
    entry.charCodeAt(0),
  );
const encodeBase64Url = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

describe("VAPID setup keys", () => {
  it("generates a matching P-256 public and private key", async () => {
    const pair = generateVapidKeyPair();
    const publicBytes = decodeBase64Url(pair.publicKey);
    const privateBytes = decodeBase64Url(pair.privateKey);

    expect(publicBytes).toHaveLength(65);
    expect(publicBytes[0]).toBe(4);
    expect(privateBytes).toHaveLength(32);
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: encodeBase64Url(publicBytes.slice(1, 33)),
        y: encodeBase64Url(publicBytes.slice(33, 65)),
        d: pair.privateKey,
        ext: true,
      },
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"],
    );
    const exported = await crypto.subtle.exportKey("jwk", privateKey);
    expect(exported.x).toBe(encodeBase64Url(publicBytes.slice(1, 33)));
    expect(exported.y).toBe(encodeBase64Url(publicBytes.slice(33, 65)));
  });

  it("accepts only a valid mail or HTTPS operator contact", () => {
    expect(validateVapidSubject("mailto:betrieb@example.de")).toBe("mailto:betrieb@example.de");
    expect(validateVapidSubject("https://example.de/kontakt")).toBe("https://example.de/kontakt");
    expect(() => validateVapidSubject("http://example.de")).toThrow(/mailto:- oder https:/);
    expect(() => validateVapidSubject("mailto:ungueltig")).toThrow(/mailto:- oder https:/);
  });
});
