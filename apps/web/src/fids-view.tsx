import { useMemo } from "react";
import { useActiveEvent } from "./event-context";
import { useAuth } from "./features/auth/AuthContext";
import { createFidsLocationAdapter } from "./features/fids/fids-location";
import { createLiveFidsDataSource } from "./features/fids/live-fids-data-source";
import { FidsDisplay } from "./fids-display";
import "./features/fids/fids-v12.css";

export function FidsView() {
  const { session, logout } = useAuth();
  const { eventId } = useActiveEvent();
  const dataSource = useMemo(() => createLiveFidsDataSource(eventId), [eventId]);
  const locationAdapter = useMemo(() => createFidsLocationAdapter(window), []);
  return (
    <FidsDisplay
      accountCode={session?.account.loginCode ?? "DISPLAY"}
      dataSource={dataSource}
      locationAdapter={locationAdapter}
      onLogout={logout}
    />
  );
}
