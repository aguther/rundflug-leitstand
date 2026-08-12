import { useMemo } from "react";
import { useActiveEvent } from "../../event-context";

export const LOCAL_DEVELOPMENT =
  import.meta.env.DEV || ["localhost", "127.0.0.1"].includes(window.location.hostname);

export interface OperationIdentity {
  eventId: string;
  deviceId: string;
  deviceToken: string;
}

export function resolveOperationIdentity(
  eventId: string,
  role: string,
  developmentId: string,
): OperationIdentity {
  const demoDevelopment = LOCAL_DEVELOPMENT && eventId === "demo-2026";
  const deviceId = demoDevelopment ? developmentId : `${role.toLowerCase()}-session`;
  let deviceToken = "";
  if (demoDevelopment) {
    if (deviceId === "cashier-tablet-1") deviceToken = "demo-cashier-device-token";
    else if (deviceId === "flight-line-tablet-1") deviceToken = "demo-flight-line-device-token";
    else if (deviceId === "recovery-flight-lead") deviceToken = "lead-device-credential";
    else deviceToken = "demo-admin-device-token";
  }
  return { eventId, deviceId, deviceToken };
}

export function useOperationIdentity(role: string, developmentId: string): OperationIdentity {
  const { eventId } = useActiveEvent();
  return useMemo(
    () => resolveOperationIdentity(eventId, role, developmentId),
    [developmentId, eventId, role],
  );
}

export function useAdminOperationIdentity(): OperationIdentity {
  return useOperationIdentity("ADMIN", "technical-scaffold");
}
