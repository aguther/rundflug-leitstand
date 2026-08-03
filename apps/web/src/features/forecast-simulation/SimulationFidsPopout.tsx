import type { FidsPreferences } from "@rundflug/contracts";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../../design-system/theme";
import { FidsDisplay } from "../../fids-display";
import { createFidsLocationAdapter } from "../fids/fids-location";
import fidsStylesheetUrl from "../fids/fids-v12.css?url";
import { createSimulationFidsDataSource } from "../fids/simulation-fids-data-source";
import { SIMULATION_PRESET_LABELS, type SimulationResult } from "./model";
import {
  advanceRecentDepartures,
  createRecentDepartureState,
  createSimulationFidsBoard,
  recentDepartureIds,
  simulationDepartedVisibilityMs,
} from "./simulation-fids";

const POPUP_NAME = "rundflug-simulation-fids";
const POPUP_FEATURES = "popup=yes,width=1600,height=900,resizable=yes,scrollbars=no";
const POPUP_PATH = "/simulation/fids";
const POPUP_STYLE_PATHS = [
  "/design-system/tokens.css",
  "/styles.css",
  "/design-system/base.css",
] as const;

interface PopupTarget {
  popup: Window;
  root: HTMLDivElement;
}

export interface SimulationFidsPopoutHandle {
  open: () => void;
}

export interface SimulationFidsPopoutProps {
  result: SimulationResult;
  clockMs: number;
  speed: number;
  visibleAt: number;
  onWindowError: (message: string | null) => void;
}

function copyPresentationHead(target: Document): void {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport) target.head.append(viewport.cloneNode(true));
  for (const source of document.head.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
    'style, link[rel="stylesheet"]',
  )) {
    const developmentStyleId = source.getAttribute("data-vite-dev-id")?.replaceAll("\\", "/");
    if (
      source instanceof HTMLLinkElement &&
      source.href.includes("/assets/ForecastSimulationView-") &&
      source.href.endsWith(".css")
    ) {
      continue;
    }
    if (
      source instanceof HTMLStyleElement &&
      !POPUP_STYLE_PATHS.some((path) => developmentStyleId?.endsWith(path))
    ) {
      continue;
    }
    const clone = source.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
    if (source instanceof HTMLLinkElement && clone instanceof HTMLLinkElement) {
      clone.href = source.href;
    }
    target.head.append(clone);
  }
}

function appendPresentationStylesheet(target: Document, stylesheetUrl: string): void {
  const stylesheet = target.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL(stylesheetUrl, window.location.href).href;
  target.head.append(stylesheet);
}

function preparePopup(popup: Window): PopupTarget {
  const target = popup.document;
  target.documentElement.lang = "de";
  target.head.replaceChildren();
  target.body.replaceChildren();
  copyPresentationHead(target);
  appendPresentationStylesheet(target, fidsStylesheetUrl);
  target.title = "Simuliertes FIDS · Rundflug-Leitstand";
  const sourceParams = new URLSearchParams(window.location.search);
  const popupParams = new URLSearchParams();
  for (const key of ["page", "setup"] as const) {
    const value = sourceParams.get(key);
    if (value) popupParams.set(key, value);
  }
  popup.history.replaceState(
    null,
    "",
    `${POPUP_PATH}${popupParams.size > 0 ? `?${popupParams.toString()}` : ""}`,
  );
  const root = target.createElement("div");
  root.id = "simulation-fids-root";
  target.body.append(root);
  return { popup, root };
}

export const SimulationFidsPopout = forwardRef<
  SimulationFidsPopoutHandle,
  SimulationFidsPopoutProps
>(function SimulationFidsPopout({ result, clockMs, speed, visibleAt, onWindowError }, ref) {
  const { resolved } = useTheme();
  const popupRef = useRef<Window | null>(null);
  const resultRef = useRef(result);
  const [target, setTarget] = useState<PopupTarget | null>(null);
  const [preferences, setPreferences] = useState<FidsPreferences>(() => ({
    visibleRows: 20,
    layout: "DOUBLE",
    theme: resolved === "dark" ? "DARK" : "LIGHT",
    viewMode: "FIXED_PAGE",
    priorityGroupCount: 3,
    rotationIntervalSeconds: 12,
    groupSharedFlights: false,
    contentFilter: { productIds: [], gateIds: [] },
    version: 0,
  }));
  const [wallNow, setWallNow] = useState(Date.now());
  const departedVisibilityMs = simulationDepartedVisibilityMs(speed);
  const [departures, setDepartures] = useState(() =>
    createRecentDepartureState(visibleAt, departedVisibilityMs),
  );

  const open = useCallback(() => {
    const current = popupRef.current;
    if (current && !current.closed) {
      current.focus();
      onWindowError(null);
      return;
    }
    const popup = window.open(POPUP_PATH, POPUP_NAME, POPUP_FEATURES);
    if (!popup) {
      onWindowError(
        "Das FIDS-Fenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben und erneut öffnen.",
      );
      return;
    }
    popupRef.current = popup;
    onWindowError(null);
    const connect = () => {
      try {
        const nextTarget = preparePopup(popup);
        setTarget(nextTarget);
        popup.focus();
      } catch {
        popup.close();
        popupRef.current = null;
        setTarget(null);
        onWindowError("Das FIDS-Fenster konnte nicht vorbereitet werden.");
      }
    };
    if (popup.document.readyState === "complete" && popup.location.pathname === POPUP_PATH) {
      connect();
    } else {
      popup.addEventListener("load", connect, { once: true });
    }
  }, [onWindowError]);

  useImperativeHandle(ref, () => ({ open }), [open]);

  useEffect(() => {
    const reset = resultRef.current !== result || target === null;
    resultRef.current = result;
    setDepartures((current) =>
      advanceRecentDepartures({
        state: current,
        rotations: result.rotations,
        visibleAt,
        wallNow: Date.now(),
        visibilityMs: departedVisibilityMs,
        reset,
      }),
    );
  }, [departedVisibilityMs, result, target, visibleAt]);

  useEffect(() => {
    if (!target) return;
    const handleClosed = () => {
      if (popupRef.current === target.popup) popupRef.current = null;
      setTarget((current) => (current?.popup === target.popup ? null : current));
    };
    target.popup.addEventListener("pagehide", handleClosed);
    const timer = window.setInterval(() => {
      if (target.popup.closed) {
        handleClosed();
        return;
      }
      setWallNow(Date.now());
    }, 1_000);
    return () => {
      target.popup.removeEventListener("pagehide", handleClosed);
      window.clearInterval(timer);
    };
  }, [target]);

  useEffect(() => {
    return () => {
      popupRef.current?.close();
      popupRef.current = null;
    };
  }, []);

  const recentIds = useMemo(
    () => recentDepartureIds(departures, wallNow, departedVisibilityMs),
    [departedVisibilityMs, departures, wallNow],
  );
  const board = useMemo(
    () =>
      createSimulationFidsBoard({
        result,
        visibleAt,
        recentDepartedRotationIds: recentIds,
      }),
    [recentIds, result, visibleAt],
  );
  const dataSource = useMemo(
    () =>
      createSimulationFidsDataSource({
        board,
        ...(result.config.operationalModel
          ? { operationalModel: result.config.operationalModel }
          : {}),
        preferences,
        onPreferencesChanged: setPreferences,
      }),
    [board, preferences, result.config.operationalModel],
  );
  const locationAdapter = useMemo(
    () => (target ? createFidsLocationAdapter(target.popup) : null),
    [target],
  );

  if (!target || !locationAdapter) return null;
  return createPortal(
    <FidsDisplay
      accountCode="SIMULATION"
      clockOverride={new Date(clockMs)}
      dataSource={dataSource}
      locationAdapter={locationAdapter}
      simulationBanner="Nur Simulation – keine Betriebsdaten"
      subtitle={`Abflugtafel · ${SIMULATION_PRESET_LABELS[result.config.preset]}`}
    />,
    target.root,
  );
});
