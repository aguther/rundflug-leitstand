import { generateKeyPairSync } from "node:crypto";

export const REQUIRED_VAPID_SECRETS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];

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

export function readVapidSubjectArgument(args) {
  const inline = args.filter((entry) => entry.startsWith("--subject="));
  const positions = args.flatMap((entry, index) => (entry === "--subject" ? [index] : []));
  if (inline.length + positions.length > 1) {
    throw new Error("VAPID_SUBJECT darf nur einmal angegeben werden.");
  }
  if (inline.length === 1) return validateVapidSubject(inline[0].slice("--subject=".length));
  if (positions.length === 0) return null;
  const value = args[positions[0] + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("Nach --subject wird eine mailto:- oder https:-Adresse benötigt.");
  }
  return validateVapidSubject(value);
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

export function findMissingVapidSecrets(entries) {
  const names = new Set(
    Array.isArray(entries)
      ? entries.flatMap((entry) =>
          entry && typeof entry === "object" && typeof entry.name === "string" ? [entry.name] : [],
        )
      : [],
  );
  return REQUIRED_VAPID_SECRETS.filter((name) => !names.has(name));
}
