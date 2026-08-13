import type { FidsPreferences } from "@rundflug/contracts";
import { AlertTriangle, ExternalLink, Monitor } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../../design-system/theme";
import { FidsDisplay } from "../../fids-display";
import { createFidsLocationAdapter } from "../fids/fids-location";
import "../fids/fids-v12.css";
import { createSimulationFidsDataSource } from "../fids/simulation-fids-data-source";
import { SIMULATION_PRESET_LABELS, type SimulationResult } from "./model";
import {
  advanceRecentDepartures,
  createRecentDepartureState,
  createSimulationFidsBoard,
  type RecentDepartureState,
  recentDepartureIds,
  simulationDepartedVisibilityMs,
} from "./simulation-fids";
import { useSimulationFidsConnection } from "./simulation-fids-channel";
import "./simulation-fids-view.css";

const EMPTY_RECENT_DEPARTURES = new Set<string>();

function initialPreferences(theme: "light" | "dark"): FidsPreferences {
  return {
    visibleRows: 20,
    layout: "DOUBLE",
    theme: theme === "dark" ? "DARK" : "LIGHT",
    viewMode: "FIXED_PAGE",
    priorityGroupCount: 3,
    rotationIntervalSeconds: 12,
    groupSharedFlights: false,
    contentFilter: { productIds: [], gateIds: [] },
    version: 0,
  };
}

function SimulationFidsWaiting({ error }: Readonly<{ error: string | null }>) {
  return (
    <main className="simulation-fids-waiting">
      <section aria-labelledby="simulation-fids-waiting-title">
        <div aria-hidden="true" className="simulation-fids-waiting-icon">
          {error ? <AlertTriangle /> : <Monitor />}
        </div>
        <p className="simulation-fids-waiting-kicker">Nur Simulation – keine Betriebsdaten</p>
        <h1 id="simulation-fids-waiting-title">
          {error ? "Simulatorverbindung nicht verfügbar" : "Warte auf laufende Simulation"}
        </h1>
        <p>
          {error ??
            "Diese Anzeige verbindet sich automatisch, sobald der Prognose-Simulator in einem anderen Tab läuft."}
        </p>
        <a
          className="simulation-fids-waiting-action"
          href="/simulation"
          rel="noopener"
          target="_blank"
        >
          Simulator in neuem Tab öffnen
          <ExternalLink aria-hidden="true" />
        </a>
      </section>
    </main>
  );
}

export function SimulationFidsView() {
  const { resolved } = useTheme();
  const connection = useSimulationFidsConnection();
  const [preferences, setPreferences] = useState<FidsPreferences>(() =>
    initialPreferences(resolved),
  );
  const [departures, setDepartures] = useState<RecentDepartureState | null>(null);
  const [wallNow, setWallNow] = useState(Date.now());
  const priorResult = useRef<SimulationResult | null>(null);
  const locationAdapter = useMemo(() => createFidsLocationAdapter(window), []);
  const state = connection.state;
  const result = state?.result ?? null;
  const visibleAt = state?.visibleAt ?? 0;
  const speed = state?.speed ?? 1;
  const departedVisibilityMs = simulationDepartedVisibilityMs(speed);

  useEffect(() => {
    document.title = "Simuliertes FIDS · Rundflug-Leitstand";
  }, []);

  useEffect(() => {
    if (!result) return;
    const reset = priorResult.current !== result;
    priorResult.current = result;
    setDepartures((current) =>
      advanceRecentDepartures({
        state: current ?? createRecentDepartureState(visibleAt, departedVisibilityMs),
        rotations: result.rotations,
        visibleAt,
        wallNow: Date.now(),
        visibilityMs: departedVisibilityMs,
        reset,
      }),
    );
  }, [departedVisibilityMs, result, visibleAt]);

  useEffect(() => {
    const timer = window.setInterval(() => setWallNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const recentIds = useMemo(
    () =>
      departures
        ? recentDepartureIds(departures, wallNow, departedVisibilityMs)
        : EMPTY_RECENT_DEPARTURES,
    [departedVisibilityMs, departures, wallNow],
  );
  const board = useMemo(
    () =>
      result
        ? createSimulationFidsBoard({
            result,
            visibleAt,
            recentDepartedRotationIds: recentIds,
          })
        : null,
    [recentIds, result, visibleAt],
  );
  const dataSource = useMemo(
    () =>
      board && result
        ? createSimulationFidsDataSource({
            board,
            ...(result.config.operationalModel
              ? { operationalModel: result.config.operationalModel }
              : {}),
            preferences,
            onPreferencesChanged: setPreferences,
            connection: state?.connected
              ? { connected: true, label: "LIVE-SIMULATION", tone: "simulation" }
              : { connected: false, label: "SIMULATION GETRENNT", tone: "offline" },
          })
        : null,
    [board, preferences, result, state?.connected],
  );

  if (!state || !result || !dataSource) return <SimulationFidsWaiting error={connection.error} />;
  return (
    <FidsDisplay
      accountCode="SIMULATION"
      clockOverride={new Date(state.clockMs)}
      dataSource={dataSource}
      locationAdapter={locationAdapter}
      simulationBanner="Nur Simulation – keine Betriebsdaten"
      subtitle={`Abflugtafel · ${SIMULATION_PRESET_LABELS[result.config.preset]}`}
    />
  );
}

export default SimulationFidsView;
