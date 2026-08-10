import type { AdminEventFlow } from "@rundflug/contracts";
import { useEffect, useState } from "react";
import { getAdminEventFlow } from "../../../api";
import { ADMIN_DEVICE_ID, deviceTokenFor, EVENT_ID } from "../../../operation-workspace";

interface UseAdminEventFlowOptions {
  active: boolean;
  administrator: boolean;
  eventVersion: number | undefined;
}

export function useAdminEventFlow({
  active,
  administrator,
  eventVersion,
}: UseAdminEventFlowOptions) {
  const [flow, setFlow] = useState<AdminEventFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (eventVersion === undefined || !active || !administrator) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void getAdminEventFlow(
      EVENT_ID,
      ADMIN_DEVICE_ID,
      deviceTokenFor(ADMIN_DEVICE_ID),
      controller.signal,
    )
      .then(setFlow)
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "Ticketverlauf nicht verfügbar.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, administrator, eventVersion]);

  return { error, flow, loading };
}
