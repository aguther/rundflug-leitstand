import { useMemo } from "react";
import { useAuth } from "./features/auth/AuthContext";
import { createFidsLocationAdapter } from "./features/fids/fids-location";
import { createLiveFidsDataSource } from "./features/fids/live-fids-data-source";
import { FidsDisplay } from "./fids-display";
import { EVENT_ID } from "./operation-workspace";
import "./features/fids/fids-v12.css";

export function FidsView() {
  const { session, logout } = useAuth();
  const dataSource = useMemo(() => createLiveFidsDataSource(EVENT_ID), []);
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
