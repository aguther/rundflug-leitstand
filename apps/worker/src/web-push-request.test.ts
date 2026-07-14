import { describe, expect, it } from "vitest";
import { buildWebPushRequest } from "./web-push-request";

const encoder = new TextEncoder();

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(
    value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "="),
  );
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function hmac(
  key: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

async function expand(
  pseudoRandomKey: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return (await hmac(pseudoRandomKey, concatBytes(info, Uint8Array.of(1)))).slice(0, length);
}

describe("native Web Push request", () => {
  it("creates an RFC 8291 aes128gcm body and a verifiable RFC 8292 VAPID token", async () => {
    const receiverKeys = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;
    const receiverPublic = new Uint8Array(
      await crypto.subtle.exportKey("raw", receiverKeys.publicKey),
    );
    const authSecret = crypto.getRandomValues(new Uint8Array(16));
    const vapidKeys = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const vapidPublic = new Uint8Array(await crypto.subtle.exportKey("raw", vapidKeys.publicKey));
    const vapidPrivateJwk = await crypto.subtle.exportKey("jwk", vapidKeys.privateKey);
    if (!vapidPrivateJwk.d) throw new Error("Test-VAPID-Schlüssel ist unvollständig.");
    const now = new Date("2026-07-14T20:00:00.000Z");
    const notification = JSON.stringify({ title: "Rundflug-Leitstand", body: "Bitte kommen." });

    const request = await buildWebPushRequest({
      data: notification,
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/test-subscription",
      p256dh: encodeBase64Url(receiverPublic),
      auth: encodeBase64Url(authSecret),
      ttl: 300,
      vapid: {
        subject: "mailto:betrieb@example.invalid",
        publicKey: encodeBase64Url(vapidPublic),
        privateKey: vapidPrivateJwk.d,
      },
      now,
    });

    expect(request.method).toBe("POST");
    expect(request.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(request.headers.TTL).toBe("300");
    expect(request.body.byteLength).toBeLessThanOrEqual(4_096);
    expect(new DataView(request.body.buffer, 16, 4).getUint32(0)).toBe(4_096);
    expect(request.body[20]).toBe(65);

    const salt = request.body.slice(0, 16);
    const senderPublic = request.body.slice(21, 86);
    const encryptedRecord = request.body.slice(86);
    const senderPublicKey = await crypto.subtle.importKey(
      "raw",
      senderPublic,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const sharedSecret = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: senderPublicKey },
        receiverKeys.privateKey,
        256,
      ),
    );
    const inputKeyMaterial = await expand(
      await hmac(authSecret, sharedSecret),
      concatBytes(encoder.encode("WebPush: info"), Uint8Array.of(0), receiverPublic, senderPublic),
      32,
    );
    const pseudoRandomKey = await hmac(salt, inputKeyMaterial);
    const contentEncryptionKey = await expand(
      pseudoRandomKey,
      concatBytes(encoder.encode("Content-Encoding: aes128gcm"), Uint8Array.of(0)),
      16,
    );
    const nonce = await expand(
      pseudoRandomKey,
      concatBytes(encoder.encode("Content-Encoding: nonce"), Uint8Array.of(0)),
      12,
    );
    const aesKey = await crypto.subtle.importKey("raw", contentEncryptionKey, "AES-GCM", false, [
      "decrypt",
    ]);
    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce, tagLength: 128 },
        aesKey,
        encryptedRecord,
      ),
    );
    expect(decrypted.at(-1)).toBe(2);
    expect(new TextDecoder().decode(decrypted.slice(0, -1))).toBe(notification);

    const authorization = request.headers.Authorization;
    if (!authorization) throw new Error("VAPID-Autorisierung fehlt.");
    expect(authorization).toMatch(/^vapid t=[^.]+\.[^.]+\.[^,]+, k=/);
    const token = authorization.slice("vapid t=".length, authorization.indexOf(", k="));
    const [headerPart, claimsPart, signaturePart] = token.split(".");
    if (!headerPart || !claimsPart || !signaturePart)
      throw new Error("VAPID-JWT ist unvollständig.");
    expect(JSON.parse(new TextDecoder().decode(decodeBase64Url(headerPart)))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(JSON.parse(new TextDecoder().decode(decodeBase64Url(claimsPart)))).toEqual({
      aud: "https://updates.push.services.mozilla.com",
      exp: Math.floor(now.getTime() / 1_000) + 12 * 60 * 60,
      sub: "mailto:betrieb@example.invalid",
    });
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        vapidKeys.publicKey,
        decodeBase64Url(signaturePart),
        encoder.encode(`${headerPart}.${claimsPart}`),
      ),
    ).toBe(true);
  });

  it("rejects oversized plaintext before contacting a push service", async () => {
    await expect(
      buildWebPushRequest({
        data: "x".repeat(3_994),
        endpoint: "https://push.services.mozilla.com/example",
        p256dh: encodeBase64Url(new Uint8Array(65).fill(4)),
        auth: encodeBase64Url(new Uint8Array(16)),
        ttl: 300,
        vapid: {
          subject: "mailto:betrieb@example.invalid",
          publicKey: encodeBase64Url(new Uint8Array(65).fill(4)),
          privateKey: encodeBase64Url(new Uint8Array(32)),
        },
      }),
    ).rejects.toThrow("Web-Push-Nachricht ist zu groß.");
  });
});
