import type { OperatorSession } from "@rundflug/contracts";
import type { PropsWithChildren } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { loadOperatorSession, logoutOperator } from "./api";

type AuthState = {
  session: OperatorSession | null;
  loading: boolean;
  unavailable: boolean;
  setSession: (session: OperatorSession) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSession(await loadOperatorSession());
      setUnavailable(false);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);
  const logout = useCallback(async () => {
    await logoutOperator();
    setSession(null);
  }, []);
  const value = useMemo(
    () => ({ session, loading, unavailable, setSession, refresh, logout }),
    [loading, logout, refresh, session, unavailable],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider fehlt");
  return value;
}
