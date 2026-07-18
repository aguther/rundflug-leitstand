import type {
  CreateOperatorAccount,
  EventCatalog,
  OperatorAccountCatalog,
  OperatorAccountSummary,
  OperatorRole,
  OperatorSession,
} from "@rundflug/contracts";
import { eventCatalogSchema } from "@rundflug/contracts";

export async function loadLoginAccounts(): Promise<OperatorAccountCatalog["accounts"]> {
  const response = await fetch("/api/auth/accounts", { cache: "no-store" });
  if (!response.ok) throw new Error("Konten konnten nicht geladen werden.");
  return ((await response.json()) as OperatorAccountCatalog).accounts;
}

export async function loadOperatorSession(): Promise<OperatorSession | null> {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Sitzung konnte nicht geprüft werden.");
  return response.json() as Promise<OperatorSession>;
}

export async function loadSelectableEvents(): Promise<EventCatalog> {
  const response = await fetch("/api/auth/events", { cache: "no-store" });
  if (!response.ok) throw new Error("Veranstaltungen konnten nicht geladen werden.");
  return eventCatalogSchema.parse(await response.json());
}

export async function loginOperator(
  accountId: string,
  pin: string,
  deviceId: string,
): Promise<OperatorSession> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, pin, deviceId }),
  });
  if (!response.ok) throw new Error("Konto oder PIN ist nicht gültig.");
  return response.json() as Promise<OperatorSession>;
}

export async function logoutOperator(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function loadManagedAccounts(): Promise<OperatorAccountSummary[]> {
  const response = await fetch("/api/admin/operator-accounts", { cache: "no-store" });
  if (!response.ok) throw new Error("Konten konnten nicht geladen werden.");
  return ((await response.json()) as { accounts: OperatorAccountSummary[] }).accounts;
}

export async function createManagedAccount(input: CreateOperatorAccount): Promise<void> {
  const response = await fetch("/api/admin/operator-accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Konto konnte nicht angelegt werden.");
}

export async function updateManagedAccount(
  accountId: string,
  input: { active?: boolean; pin?: string; revokeSessions?: true },
): Promise<void> {
  const response = await fetch(`/api/admin/operator-accounts/${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Konto konnte nicht geändert werden.");
}

export type LoginAccount = Pick<OperatorAccountSummary, "id" | "loginCode" | "role">;

export const roleLabels: Record<OperatorRole, string> = {
  ADMIN: "Administration",
  CASHIER: "Kasse",
  FLIGHT_LINE: "Flight Line Assist",
  FLIGHT_LINE_LEAD: "Flight Line Supervisor",
  FLIGHT_DIRECTOR: "Leitstand",
  DISPLAY: "Anzeige",
};

export const loginRoleOrder: readonly OperatorRole[] = [
  "ADMIN",
  "FLIGHT_DIRECTOR",
  "FLIGHT_LINE_LEAD",
  "FLIGHT_LINE",
  "CASHIER",
  "DISPLAY",
];
