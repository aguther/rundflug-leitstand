import { useEffect, useState } from "react";

export type ConnectionStatus = "checking" | "connected" | "degraded" | "offline";

export function resolveConnectionStatus({
  online,
  error,
  lastConfirmedAt,
  backendConfirmed,
  tracksBackend = true,
}: {
  online: boolean;
  error?: string | null | undefined;
  lastConfirmedAt?: string | null | undefined;
  backendConfirmed?: boolean | undefined;
  tracksBackend?: boolean;
}): ConnectionStatus {
  if (!online) return "offline";
  if (!tracksBackend) return "connected";
  if (error) return "degraded";
  return (backendConfirmed ?? Boolean(lastConfirmedAt)) ? "connected" : "checking";
}

export function useConnectivity(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
