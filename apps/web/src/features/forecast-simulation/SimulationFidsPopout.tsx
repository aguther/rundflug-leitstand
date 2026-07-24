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
import { FidsBoardPresentation } from "../../fids-display";
import { SIMULATION_PRESET_LABELS, type SimulationResult } from "./model";
import {
  advanceRecentDepartures,
  createRecentDepartureState,
  createSimulationFidsBoard,
  recentDepartureIds,
} from "./simulation-fids";

const POPUP_NAME = "rundflug-simulation-fids";
const POPUP_FEATURES = "popup=yes,width=1600,height=900,resizable=yes,scrollbars=no";
const POPUP_STYLE_PATHS = [
  "/design-system/tokens.css",
  "/styles.css",
  "/features/fids/fids-v12.css",
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

function preparePopup(popup: Window): PopupTarget {
  const target = popup.document;
  target.documentElement.lang = "de";
  target.head.replaceChildren();
  target.body.replaceChildren();
  copyPresentationHead(target);
  target.title = "Simuliertes FIDS · Rundflug-Leitstand";
  const root = target.createElement("div");
  root.id = "simulation-fids-root";
  target.body.append(root);
  return { popup, root };
}

export const SimulationFidsPopout = forwardRef<
  SimulationFidsPopoutHandle,
  SimulationFidsPopoutProps
>(function SimulationFidsPopout({ result, clockMs, visibleAt, onWindowError }, ref) {
  const { resolved } = useTheme();
  const popupRef = useRef<Window | null>(null);
  const resultRef = useRef(result);
  const [target, setTarget] = useState<PopupTarget | null>(null);
  const [wallNow, setWallNow] = useState(Date.now());
  const [departures, setDepartures] = useState(() => createRecentDepartureState(visibleAt));

  const open = useCallback(() => {
    const current = popupRef.current;
    if (current && !current.closed) {
      current.focus();
      onWindowError(null);
      return;
    }
    const popup = window.open("", POPUP_NAME, POPUP_FEATURES);
    if (!popup) {
      onWindowError(
        "Das FIDS-Fenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben und erneut öffnen.",
      );
      return;
    }
    try {
      const nextTarget = preparePopup(popup);
      popupRef.current = popup;
      setTarget(nextTarget);
      popup.focus();
      onWindowError(null);
    } catch {
      popup.close();
      popupRef.current = null;
      setTarget(null);
      onWindowError("Das FIDS-Fenster konnte nicht vorbereitet werden.");
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
        reset,
      }),
    );
  }, [result, target, visibleAt]);

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

  const recentIds = useMemo(() => recentDepartureIds(departures, wallNow), [departures, wallNow]);
  const board = useMemo(
    () =>
      createSimulationFidsBoard({
        result,
        visibleAt,
        recentDepartedRotationIds: recentIds,
      }),
    [recentIds, result, visibleAt],
  );
  const preferences = useMemo<FidsPreferences>(
    () => ({
      visibleRows: 8,
      layout: "SINGLE",
      theme: resolved === "dark" ? "DARK" : "LIGHT",
      version: 0,
    }),
    [resolved],
  );

  if (!target) return null;
  return createPortal(
    <FidsBoardPresentation
      board={board}
      clock={new Date(clockMs)}
      connectionLabel="LIVE-SIMULATION"
      connectionTone="simulation"
      error={null}
      filterDeparted={false}
      footerNote="Virtuelle Zeit"
      preferences={preferences}
      simulationBanner="Nur Simulation – keine Betriebsdaten"
      subtitle={`Abflugtafel · ${SIMULATION_PRESET_LABELS[result.config.preset]}`}
    />,
    target.root,
  );
});
