import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminArea, AdminEventStep, SetupStep } from "../../../admin-ux";

const ADMIN_AREAS: AdminArea[] = ["overview", "events", "users", "evaluation", "backup"];
const EVENT_STEPS: AdminEventStep[] = [
  "event",
  "gates",
  "resource-groups",
  "aircraft",
  "pilots",
  "products",
  "operational-plan",
  "operations",
  "completion",
];

function initialAdminArea(params: URLSearchParams): AdminArea {
  const requestedArea = params.get("area");
  if (["setup", "master-data", "audit"].includes(requestedArea ?? "")) return "events";
  return (ADMIN_AREAS as string[]).includes(requestedArea ?? "")
    ? (requestedArea as AdminArea)
    : "overview";
}

function initialEventStep(params: URLSearchParams): AdminEventStep {
  const requestedArea = params.get("area");
  const requestedStep = params.get("step");
  const legacySection = params.get("section");
  if ((EVENT_STEPS as string[]).includes(requestedStep ?? "")) {
    return requestedStep as AdminEventStep;
  }
  if (requestedArea === "audit") return "completion";
  if (requestedArea === "master-data") {
    if (legacySection === "assignments") return "aircraft";
    if ((EVENT_STEPS as string[]).includes(legacySection ?? "")) {
      return legacySection as AdminEventStep;
    }
    return "resource-groups";
  }
  return "event";
}

export function useAdminEventWorkspaceNavigation(input: {
  initialParams: URLSearchParams;
  onStepSelected?: (step: SetupStep) => void;
}) {
  const [adminArea, setAdminArea] = useState<AdminArea>(() =>
    initialAdminArea(input.initialParams),
  );
  const [eventStep, setEventStep] = useState<AdminEventStep>(() =>
    initialEventStep(input.initialParams),
  );
  const [eventParametersDirty, setEventParametersDirty] = useState(false);
  const [eventParametersResetKey, setEventParametersResetKey] = useState(0);
  const [discardEventNavigationOpen, setDiscardEventNavigationOpen] = useState(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const adminWorkspaceScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("area", adminArea);
    if (adminArea === "events") url.searchParams.set("step", eventStep);
    else url.searchParams.delete("step");
    url.searchParams.delete("section");
    window.history.replaceState(null, "", url);
  }, [adminArea, eventStep]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: changing area or step intentionally resets the independent content scroller
  useEffect(() => {
    adminWorkspaceScrollRef.current?.scrollTo({ top: 0 });
  }, [adminArea, eventStep]);

  useEffect(() => {
    if (!eventParametersDirty) return;
    const warnBeforeUnload = (unloadEvent: BeforeUnloadEvent) => {
      unloadEvent.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [eventParametersDirty]);

  const requestNavigation = useCallback(
    (action: () => void) => {
      if (!eventParametersDirty) {
        action();
        return;
      }
      pendingNavigationRef.current = action;
      setDiscardEventNavigationOpen(true);
    },
    [eventParametersDirty],
  );

  const changeAdminArea = useCallback(
    (nextArea: AdminArea) => {
      if (nextArea === adminArea) return;
      requestNavigation(() => setAdminArea(nextArea));
    },
    [adminArea, requestNavigation],
  );

  const openSetupStep = useCallback(
    (step: SetupStep) => {
      if (adminArea === "events" && eventStep === step.id) return;
      requestNavigation(() => {
        setAdminArea("events");
        setEventStep(step.id);
        input.onStepSelected?.(step);
      });
    },
    [adminArea, eventStep, input.onStepSelected, requestNavigation],
  );

  const cancelPendingNavigation = useCallback(() => {
    pendingNavigationRef.current = null;
    setDiscardEventNavigationOpen(false);
  }, []);

  const confirmPendingNavigation = useCallback(() => {
    const action = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    setDiscardEventNavigationOpen(false);
    setEventParametersDirty(false);
    setEventParametersResetKey((current) => current + 1);
    action?.();
  }, []);

  return {
    adminArea,
    adminWorkspaceScrollRef,
    cancelPendingNavigation,
    changeAdminArea,
    confirmPendingNavigation,
    discardEventNavigationOpen,
    eventParametersDirty,
    eventParametersResetKey,
    eventStep,
    openSetupStep,
    setEventParametersDirty,
  };
}
