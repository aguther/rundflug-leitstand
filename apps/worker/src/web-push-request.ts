const encoder = new TextEncoder();
const MAX_PAYLOAD_BYTES = 3_993;
const RECORD_SIZE = 4_096;
const VAPID_LIFETIME_SECONDS = 12 * 60 * 60;

export interface WebPushRequestInput {
  data: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  vapid: {
    subject: string;
    publicKey: string;
    privateKey: string;
  };
  ttl: number;
  now?: Date;
}

export interface WebPushRequest {
  method: "POST";
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer>;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Web-Push-Schlüssel ist ungültig.");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function assertLength(value: Uint8Array, expected: number, label: string): void {
  if (value.byteLength !== expected) throw new Error(`${label} ist ungültig.`);
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

async function hkdfExpand(
  pseudoRandomKey: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return (await hmac(pseudoRandomKey, concatBytes(info, Uint8Array.of(1)))).slice(0, length);
}

async function createEncryptedBody(
  data: Uint8Array<ArrayBuffer>,
  receiverPublicBytes: Uint8Array<ArrayBuffer>,
  authSecret: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const receiverPublicKey = await crypto.subtle.importKey(
    "raw",
    receiverPublicBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const senderKeys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const senderPublicBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", senderKeys.publicKey),
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: receiverPublicKey },
      senderKeys.privateKey,
      256,
    ),
  );
  const inputKeyMaterial = await hkdfExpand(
    await hmac(authSecret, sharedSecret),
    concatBytes(
      encoder.encode("WebPush: info"),
      Uint8Array.of(0),
      receiverPublicBytes,
      senderPublicBytes,
    ),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pseudoRandomKey = await hmac(salt, inputKeyMaterial);
  const contentEncryptionKey = await hkdfExpand(
    pseudoRandomKey,
    concatBytes(encoder.encode("Content-Encoding: aes128gcm"), Uint8Array.of(0)),
    16,
  );
  const nonce = await hkdfExpand(
    pseudoRandomKey,
    concatBytes(encoder.encode("Content-Encoding: nonce"), Uint8Array.of(0)),
    12,
  );
  const aesKey = await crypto.subtle.importKey(
    "raw",
    contentEncryptionKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const encryptedRecord = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      aesKey,
      concatBytes(data, Uint8Array.of(2)),
    ),
  );
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE);
  return concatBytes(
    salt,
    recordSize,
    Uint8Array.of(senderPublicBytes.byteLength),
    senderPublicBytes,
    encryptedRecord,
  );
}

async function createVapidAuthorization(
  endpoint: URL,
  subject: string,
  publicKeyValue: string,
  publicKeyBytes: Uint8Array<ArrayBuffer>,
  privateKeyBytes: Uint8Array<ArrayBuffer>,
  now: Date,
): Promise<string> {
  if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
    throw new Error("VAPID_SUBJECT muss eine mailto:- oder https:-Adresse sein.");
  }
  const header = encodeBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = encodeBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: endpoint.origin,
        exp: Math.floor(now.getTime() / 1_000) + VAPID_LIFETIME_SECONDS,
        sub: subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: encodeBase64Url(publicKeyBytes.slice(1, 33)),
      y: encodeBase64Url(publicKeyBytes.slice(33, 65)),
      d: encodeBase64Url(privateKeyBytes),
      ext: true,
      key_ops: ["sign"],
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      encoder.encode(signingInput),
    ),
  );
  return `vapid t=${signingInput}.${encodeBase64Url(signature)}, k=${publicKeyValue}`;
}

export async function buildWebPushRequest(input: WebPushRequestInput): Promise<WebPushRequest> {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("Web-Push-Endpunkt muss HTTPS verwenden.");
  if (!Number.isInteger(input.ttl) || input.ttl < 0) throw new Error("Web-Push-TTL ist ungültig.");
  const data = encoder.encode(input.data);
  if (data.byteLength > MAX_PAYLOAD_BYTES) throw new Error("Web-Push-Nachricht ist zu groß.");
  const receiverPublicBytes = decodeBase64Url(input.p256dh);
  const authSecret = decodeBase64Url(input.auth);
  const vapidPublicBytes = decodeBase64Url(input.vapid.publicKey);
  const vapidPrivateBytes = decodeBase64Url(input.vapid.privateKey);
  assertLength(receiverPublicBytes, 65, "Web-Push-Empfängerschlüssel");
  assertLength(authSecret, 16, "Web-Push-Authentifizierungswert");
  assertLength(vapidPublicBytes, 65, "VAPID_PUBLIC_KEY");
  assertLength(vapidPrivateBytes, 32, "VAPID_PRIVATE_KEY");
  if (receiverPublicBytes[0] !== 4 || vapidPublicBytes[0] !== 4) {
    throw new Error("Web-Push-P-256-Schlüssel ist ungültig.");
  }
  return {
    method: "POST",
    headers: {
      Authorization: await createVapidAuthorization(
        endpoint,
        input.vapid.subject,
        input.vapid.publicKey,
        vapidPublicBytes,
        vapidPrivateBytes,
        input.now ?? new Date(),
      ),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(input.ttl),
    },
    body: await createEncryptedBody(data, receiverPublicBytes, authSecret),
  };
}
