import { generateKeyPairSync } from "node:crypto";

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url");
}

export function validateVapidSubject(value) {
  const subject = value.trim();
  if (subject.startsWith("mailto:")) {
    const address = subject.slice("mailto:".length);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return subject;
  }
  if (subject.startsWith("https://")) {
    try {
      const url = new URL(subject);
      if (url.username === "" && url.password === "") return url.toString();
    } catch {}
  }
  throw new Error("VAPID_SUBJECT muss eine mailto:- oder https:-Adresse sein.");
}

export function generateVapidKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });
  if (!publicJwk.x || !publicJwk.y || !privateJwk.d) {
    throw new Error("Das VAPID-Schlüsselpaar konnte nicht vollständig erzeugt werden.");
  }
  const x = decodeBase64Url(publicJwk.x);
  const y = decodeBase64Url(publicJwk.y);
  const privateBytes = decodeBase64Url(privateJwk.d);
  if (x.length !== 32 || y.length !== 32 || privateBytes.length !== 32) {
    throw new Error("Das VAPID-Schlüsselpaar hat eine ungültige P-256-Länge.");
  }
  return {
    publicKey: Buffer.concat([Buffer.from([4]), x, y]).toString("base64url"),
    privateKey: privateJwk.d,
  };
}
