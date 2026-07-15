export interface CashierDraft {
  productId: string;
  size: number;
}

export interface CashierDraftRevision {
  id: string;
  createdAt: string;
  draft: CashierDraft;
}

export function cashierDraftQueueKey(eventId: string, deviceId: string): string {
  return `cashier-draft-queue:v1:${eventId}:${deviceId}`;
}

export function appendCashierDraftRevision(
  queue: readonly CashierDraftRevision[],
  draft: CashierDraft,
  id: string = crypto.randomUUID(),
  createdAt = new Date().toISOString(),
): CashierDraftRevision[] {
  const previous = queue.at(-1)?.draft;
  if (previous?.productId === draft.productId && previous.size === draft.size) {
    const current = queue.at(-1);
    return current ? [current] : [];
  }
  return [{ id, createdAt, draft }];
}

export function readCashierDraftQueue(
  storage: Pick<Storage, "getItem">,
  key: string,
): CashierDraftRevision[] {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter((entry): entry is CashierDraftRevision => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Partial<CashierDraftRevision>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.createdAt === "string" &&
        Number.isFinite(Date.parse(candidate.createdAt)) &&
        typeof candidate.draft?.productId === "string" &&
        Number.isInteger(candidate.draft.size) &&
        (candidate.draft.size ?? 0) >= 1 &&
        (candidate.draft.size ?? 0) <= 12
      );
    });
    return valid.slice(-1);
  } catch {
    return [];
  }
}

export function writeCashierDraftQueue(
  storage: Pick<Storage, "setItem">,
  key: string,
  queue: readonly CashierDraftRevision[],
): void {
  storage.setItem(key, JSON.stringify(queue));
}

export function latestCashierDraft(queue: readonly CashierDraftRevision[]): CashierDraft | null {
  return queue.at(-1)?.draft ?? null;
}
