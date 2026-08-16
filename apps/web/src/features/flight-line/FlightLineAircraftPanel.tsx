import type { OperationBoard } from "@rundflug/contracts";
import {
  aircraftStateLabel,
  operationalTimeLabel,
  rotationStatusLabel,
} from "../operations/operation-labels";
import { LegacyAircraftActions } from "./FlightLineViewPresentation";

type Aircraft = OperationBoard["aircraft"][number];
type Rotation = OperationBoard["rotations"][number];

interface FlightLineAircraftSelectorProps {
  aircraft: Aircraft[];
  onSelect: (aircraftId: string) => void;
  rotations: Rotation[];
  selectedAircraft: Aircraft | null | undefined;
}

export function FlightLineAircraftSelector({
  aircraft,
  onSelect,
  rotations,
  selectedAircraft,
}: FlightLineAircraftSelectorProps) {
  return (
    <nav className="aircraft-selector" aria-label="Flugzeug auswählen">
      <div className="aircraft-selector-heading">
        <strong>Flugzeuge</strong>
        <span>{aircraft.length}</span>
      </div>
      {aircraft.map((entry) => {
        const assignedRotation = rotations.find((rotation) => rotation.aircraftId === entry.id);
        return (
          <button
            className={entry.id === selectedAircraft?.id ? "selected" : ""}
            key={entry.id}
            onClick={() => onSelect(entry.id)}
            type="button"
          >
            <strong>{entry.registration}</strong>
            <span>{entry.passengerSeats} Plätze</span>
            <small>
              {assignedRotation
                ? `${assignedRotation.communicationLabel} · ${rotationStatusLabel[assignedRotation.status]}`
                : aircraftStateLabel[entry.operationalState]}
            </small>
          </button>
        );
      })}
    </nav>
  );
}

interface FlightLineAircraftSummaryProps {
  aircraft: Aircraft | null | undefined;
  canManageAircraft: boolean;
  onPause: () => void;
  onSetState: (state: "AVAILABLE" | "REFUELING" | "INACTIVE") => Promise<void>;
  timeZone: string;
}

export function FlightLineAircraftSummary({
  aircraft,
  canManageAircraft,
  onPause,
  onSetState,
  timeZone,
}: FlightLineAircraftSummaryProps) {
  if (!aircraft) return null;
  return (
    <section className="supervisor-aircraft-summary">
      <div>
        <span>Ausgewähltes Flugzeug</span>
        <h1>{aircraft.registration}</h1>
        <p>
          {aircraft.aircraftType} · {aircraft.passengerSeats} Plätze ·{" "}
          {aircraft.resourceGroupName || "Keine Ressourcengruppe"}
        </p>
      </div>
      <strong className={`aircraft-state state-${aircraft.operationalState.toLowerCase()}`}>
        {aircraftStateLabel[aircraft.operationalState]}
      </strong>
      {aircraft.expectedReviewAt ? (
        <small>
          Erwartete Rückkehr {operationalTimeLabel(aircraft.expectedReviewAt, timeZone)}
        </small>
      ) : null}
      <div className="supervisor-aircraft-actions">
        <LegacyAircraftActions
          aircraft={aircraft}
          canManageAircraft={canManageAircraft}
          onPause={onPause}
          onSetState={(state) => void onSetState(state)}
        />
      </div>
    </section>
  );
}
