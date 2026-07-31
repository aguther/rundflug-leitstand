import type { OperationBoard } from "@rundflug/contracts";
import { RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import { Button, ModalDialog, StatusPill } from "../../../design-system/components";

export type TurnaroundOverrideContext =
  | { mode: "aircraft"; aircraftId: string }
  | { mode: "product"; productId: string };

type OverrideValues = {
  boarding: number | null;
  deboarding: number | null;
  buffer: number | null;
};

type Override = OperationBoard["aircraftProductTurnaroundOverrides"][number];
type Product = OperationBoard["products"][number];

function sourceLabel(source: "AIRCRAFT_PRODUCT" | "PRODUCT" | "EVENT"): string {
  if (source === "AIRCRAFT_PRODUCT") return "Flugzeug und Produkt";
  return source === "PRODUCT" ? "Produkt" : "Veranstaltung";
}

function TurnaroundPhaseControl({
  label,
  value,
  inheritedValue,
  inheritedSource,
  onChange,
}: {
  label: string;
  value: string;
  inheritedValue: number;
  inheritedSource: "PRODUCT" | "EVENT";
  onChange: (value: string) => void;
}) {
  const explicit = value !== "";
  return (
    <div className="turnaround-phase-control">
      <span>{label}</span>
      {explicit ? (
        <label>
          <span className="sr-only">{label} in Minuten</span>
          <input
            min={0}
            onChange={(event) => onChange(event.target.value)}
            step={1}
            type="number"
            value={value}
          />
          <span>Min.</span>
        </label>
      ) : (
        <strong>{inheritedValue} Min.</strong>
      )}
      <small>Quelle: {explicit ? "Flugzeug und Produkt" : sourceLabel(inheritedSource)}</small>
      <button
        className="table-action"
        onClick={() => onChange(explicit ? "" : String(inheritedValue))}
        type="button"
      >
        {explicit ? <RotateCcw aria-hidden="true" /> : null}
        {explicit ? "Vererbung verwenden" : "Abweichung festlegen"}
      </button>
    </div>
  );
}

function TurnaroundOverrideRow({
  aircraft,
  product,
  override,
  busy,
  onSave,
}: {
  aircraft: OperationBoard["aircraft"][number];
  product: Product;
  override?: Override | undefined;
  busy: boolean;
  onSave: (aircraftId: string, productId: string, values: OverrideValues) => void;
}) {
  const [boarding, setBoarding] = useState(
    override?.plannedBoardingMinutesOverride?.toString() ?? "",
  );
  const [deboarding, setDeboarding] = useState(
    override?.plannedDeboardingMinutesOverride?.toString() ?? "",
  );
  const [buffer, setBuffer] = useState(override?.plannedBufferMinutesOverride?.toString() ?? "");
  const initial = [
    override?.plannedBoardingMinutesOverride?.toString() ?? "",
    override?.plannedDeboardingMinutesOverride?.toString() ?? "",
    override?.plannedBufferMinutesOverride?.toString() ?? "",
  ];
  const dirty = boarding !== initial[0] || deboarding !== initial[1] || buffer !== initial[2];
  const baseline = product.effectiveTurnaroundProfile;
  const invalid = [boarding, deboarding, buffer].some(
    (value) => value !== "" && (!Number.isInteger(Number(value)) || Number(value) < 0),
  );
  return (
    <article className="turnaround-override-row">
      <header>
        <div>
          <strong>
            {product.code} · {product.name}
          </strong>
          <span>{aircraft.registration}</span>
        </div>
        <StatusPill tone={override ? "info" : "neutral"}>
          {override ? "Abweichung" : "Vererbt"}
        </StatusPill>
      </header>
      <div className="turnaround-override-phases">
        <TurnaroundPhaseControl
          inheritedSource={baseline.boarding.sourceLevel === "EVENT" ? "EVENT" : "PRODUCT"}
          inheritedValue={baseline.boarding.valueMinutes}
          label="Boarding"
          onChange={setBoarding}
          value={boarding}
        />
        <TurnaroundPhaseControl
          inheritedSource={baseline.deboarding.sourceLevel === "EVENT" ? "EVENT" : "PRODUCT"}
          inheritedValue={baseline.deboarding.valueMinutes}
          label="Ausstieg"
          onChange={setDeboarding}
          value={deboarding}
        />
        <TurnaroundPhaseControl
          inheritedSource={baseline.buffer.sourceLevel === "EVENT" ? "EVENT" : "PRODUCT"}
          inheritedValue={baseline.buffer.valueMinutes}
          label="Puffer"
          onChange={setBuffer}
          value={buffer}
        />
      </div>
      <footer>
        <Button
          busy={busy}
          disabled={!dirty || invalid || busy}
          onClick={() =>
            onSave(aircraft.id, product.id, {
              boarding: boarding === "" ? null : Number(boarding),
              deboarding: deboarding === "" ? null : Number(deboarding),
              buffer: buffer === "" ? null : Number(buffer),
            })
          }
          size="compact"
          type="button"
          variant="secondary"
        >
          <Save aria-hidden="true" /> Änderung speichern
        </Button>
      </footer>
    </article>
  );
}

export function AircraftProductTurnaroundOverrideDialog({
  board,
  context,
  busyKey,
  onClose,
  onSave,
}: {
  board: OperationBoard;
  context: TurnaroundOverrideContext | null;
  busyKey: string | null;
  onClose: () => void;
  onSave: (aircraftId: string, productId: string, values: OverrideValues) => void;
}) {
  if (!context) return null;
  const rows =
    context.mode === "aircraft"
      ? board.products.map((product) => ({
          aircraft: board.aircraft.find((entry) => entry.id === context.aircraftId),
          product,
        }))
      : board.aircraft.map((aircraft) => ({
          aircraft,
          product: board.products.find((entry) => entry.id === context.productId),
        }));
  const fixedLabel =
    context.mode === "aircraft"
      ? board.aircraft.find((entry) => entry.id === context.aircraftId)?.registration
      : board.products.find((entry) => entry.id === context.productId)?.name;
  return (
    <ModalDialog
      className="turnaround-override-dialog"
      description={`${fixedLabel ?? "Auswahl"}: Boarding, Ausstieg und Puffer werden für jede konkrete Kombination unabhängig aufgelöst.`}
      footer={
        <Button disabled={busyKey !== null} onClick={onClose} type="button" variant="secondary">
          Schließen
        </Button>
      }
      onClose={onClose}
      open
      portal
      size="wide"
      title="Abweichende Bodenzeiten verwalten"
    >
      <div className="turnaround-override-list">
        {rows.flatMap(({ aircraft, product }) => {
          if (!aircraft || !product) return [];
          const override = board.aircraftProductTurnaroundOverrides.find(
            (entry) => entry.aircraftId === aircraft.id && entry.productId === product.id,
          );
          const rowKey = `${aircraft.id}:${product.id}:${override?.version ?? "inherited"}`;
          return [
            <TurnaroundOverrideRow
              aircraft={aircraft}
              busy={busyKey === `turnaround-${aircraft.id}-${product.id}`}
              key={rowKey}
              onSave={onSave}
              override={override}
              product={product}
            />,
          ];
        })}
      </div>
    </ModalDialog>
  );
}
