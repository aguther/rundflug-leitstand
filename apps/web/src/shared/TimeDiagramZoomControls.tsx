import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "../design-system/components";
import "./time-diagram-viewport.css";

export function TimeDiagramZoomControls({
  onChange,
  onReset,
  value,
  zoomLevels,
}: Readonly<{
  onChange: (zoom: number) => void;
  onReset: () => void;
  value: number;
  zoomLevels: readonly number[];
}>) {
  const index = zoomLevels.indexOf(value);
  return (
    <fieldset className="time-diagram-zoom">
      <legend className="visually-hidden">Diagramm-Zoom</legend>
      <small>Mausrad: Zoom · Ziehen: Verschieben</small>
      <Button
        aria-label="Diagramm verkleinern"
        disabled={index <= 0}
        onClick={() => onChange(zoomLevels[Math.max(0, index - 1)] ?? 1)}
        type="button"
        variant="secondary"
      >
        <ZoomOut aria-hidden="true" />
      </Button>
      <span aria-live="polite">{Math.round(value * 100)} %</span>
      <Button
        aria-label="Diagramm vergrößern"
        disabled={index < 0 || index >= zoomLevels.length - 1}
        onClick={() => onChange(zoomLevels[Math.min(zoomLevels.length - 1, index + 1)] ?? value)}
        type="button"
        variant="secondary"
      >
        <ZoomIn aria-hidden="true" />
      </Button>
      <Button
        aria-label="Gesamten Zeitverlauf anzeigen"
        disabled={value === 1}
        onClick={onReset}
        type="button"
        variant="secondary"
      >
        <Maximize2 aria-hidden="true" />
        Gesamt
      </Button>
    </fieldset>
  );
}
