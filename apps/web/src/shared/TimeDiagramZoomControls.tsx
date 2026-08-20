import { LocateFixed, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "../design-system/components";
import "./time-diagram-viewport.css";

export function TimeDiagramZoomControls({
  onChange,
  onResumeFollowing,
  onReset,
  following,
  showInteractionHint = true,
  value,
  zoomLevels,
}: Readonly<{
  onChange: (zoom: number) => void;
  onResumeFollowing?: () => void;
  onReset: () => void;
  following?: boolean;
  showInteractionHint?: boolean;
  value: number;
  zoomLevels: readonly number[];
}>) {
  const index = zoomLevels.indexOf(value);
  return (
    <div className="time-diagram-zoom">
      {showInteractionHint ? (
        <small>Mausrad/Ziehen: Verschieben · Strg + Mausrad: Zoom</small>
      ) : null}
      <fieldset className="time-diagram-zoom-actions">
        <legend className="visually-hidden">Diagramm-Zoom</legend>
        <Button
          aria-label="Diagramm verkleinern"
          disabled={index <= 0}
          onClick={() => onChange(zoomLevels[Math.max(0, index - 1)] ?? 1)}
          title="Diagramm verkleinern"
          type="button"
          variant="secondary"
        >
          <ZoomOut aria-hidden="true" />
        </Button>
        <Button
          aria-label="Diagramm vergrößern"
          disabled={index < 0 || index >= zoomLevels.length - 1}
          onClick={() => onChange(zoomLevels[Math.min(zoomLevels.length - 1, index + 1)] ?? value)}
          title="Diagramm vergrößern"
          type="button"
          variant="secondary"
        >
          <ZoomIn aria-hidden="true" />
        </Button>
        <Button
          aria-label="Gesamten Zeitverlauf anzeigen"
          disabled={value === 1 && !following}
          onClick={onReset}
          title="Gesamten Zeitverlauf anzeigen"
          type="button"
          variant="secondary"
        >
          <Maximize2 aria-hidden="true" />
        </Button>
      </fieldset>
      {onResumeFollowing ? (
        <Button
          aria-label="Aktuell folgen"
          className="time-diagram-follow"
          disabled={following}
          onClick={onResumeFollowing}
          title="Aktuell folgen"
          type="button"
          variant="secondary"
        >
          <LocateFixed aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
