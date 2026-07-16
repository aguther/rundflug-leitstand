interface TicketAttemptRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

async function actorHash(request: Request, discriminator = ""): Promise<string> {
  const actor = request.headers.get("cf-connecting-ip")?.trim() || "unknown-client";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${actor}:${discriminator}`),
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function allowUnknownTicketAttempt(
  limiter: TicketAttemptRateLimiter,
  request: Request,
): Promise<boolean> {
  const result = await limiter.limit({ key: `unknown-ticket:${await actorHash(request)}` });
  return result.success;
}

export async function allowAdminDeviceRecoveryAttempt(
  limiter: TicketAttemptRateLimiter,
  request: Request,
): Promise<boolean> {
  const result = await limiter.limit({
    key: `admin-device-recovery:${await actorHash(request)}`,
  });
  return result.success;
}
