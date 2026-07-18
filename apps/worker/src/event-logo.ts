export const MAX_EVENT_LOGO_BYTES = 1024 * 1024;

export type EventLogoMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function validateEventLogo(
  bytes: Uint8Array,
  claimedMediaType: string | null,
): EventLogoMediaType {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EVENT_LOGO_BYTES) {
    throw new Error("EVENT_LOGO_SIZE_INVALID");
  }
  let detected: EventLogoMediaType | null = null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    detected = "image/png";
  } else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    detected = "image/jpeg";
  } else if (
    new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    detected = "image/webp";
  } else {
    const text = new TextDecoder().decode(bytes).trim();
    if (/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) {
      if (
        /<\s*(?:script|foreignObject|iframe|object|embed)\b/i.test(text) ||
        /\bon[a-z]+\s*=/i.test(text) ||
        /(?:href|src)\s*=\s*["']\s*(?:https?:|data:|javascript:|\/\/)/i.test(text)
      ) {
        throw new Error("EVENT_LOGO_SVG_UNSAFE");
      }
      detected = "image/svg+xml";
    }
  }
  const normalizedClaim = claimedMediaType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!detected || (normalizedClaim && normalizedClaim !== detected)) {
    throw new Error("EVENT_LOGO_MEDIA_TYPE_INVALID");
  }
  return detected;
}

export function eventLogoExtension(mediaType: EventLogoMediaType): string {
  return {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  }[mediaType];
}
