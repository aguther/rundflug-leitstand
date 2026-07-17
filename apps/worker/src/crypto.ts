export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyCredential(
  token: string | null,
  expectedHash: string | null,
): Promise<boolean> {
  if (!token || !expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  const expected = Uint8Array.from(expectedHash.match(/.{2}/g) ?? [], (hex) =>
    Number.parseInt(hex, 16),
  );
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}

const PIN_HASH_ITERATIONS = 210_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePin(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const saltBuffer = new Uint8Array(salt).buffer;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{6,12}$/.test(pin)) throw new Error("PIN_FORMAT_INVALID");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePin(pin, salt, PIN_HASH_ITERATIONS);
  return `pbkdf2-sha256$${PIN_HASH_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(derived)}`;
}

export async function verifyPin(pin: string, encoded: string): Promise<boolean> {
  const [algorithm, rawIterations, rawSalt, rawExpected] = encoded.split("$");
  const iterations = Number.parseInt(rawIterations ?? "", 10);
  if (
    algorithm !== "pbkdf2-sha256" ||
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    !rawSalt ||
    !rawExpected ||
    !/^\d{6,12}$/.test(pin)
  ) {
    return false;
  }
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64UrlToBytes(rawSalt);
    expected = base64UrlToBytes(rawExpected);
  } catch {
    return false;
  }
  const actual = await derivePin(pin, salt, iterations);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}

export function randomToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}
