import { lazy, Suspense } from "react";

const ForecastSimulationView = lazy(
  () => import("./features/forecast-simulation/ForecastSimulationView"),
);
const SimulationFidsView = lazy(() => import("./features/forecast-simulation/SimulationFidsView"));

export function isSimulatorRoute(pathname: string): boolean {
  return pathname === "/simulation" || pathname === "/simulation/fids";
}

export function SimulatorRouter() {
  const View =
    window.location.pathname === "/simulation/fids" ? SimulationFidsView : ForecastSimulationView;
  return (
    <Suspense fallback={<output className="app-loading">Arbeitsbereich wird geladen …</output>}>
      <View />
    </Suspense>
  );
}
