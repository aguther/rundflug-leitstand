interface TicketAttemptRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export async function allowUnknownTicketAttempt(
  limiter: TicketAttemptRateLimiter,
  request: Request,
): Promise<boolean> {
  const actor = request.headers.get("cf-connecting-ip")?.trim() || "unknown-client";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(actor));
  const actorHash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const result = await limiter.limit({ key: `unknown-ticket:${actorHash}` });
  return result.success;
}
