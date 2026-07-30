import { deriveReferenceRotationBreakdown } from "@rundflug/domain";

export interface ProductReferenceRotationProps {
  boardingMinutes: number;
  offBlockToOnBlockMinutes: number;
  deboardingMinutes: number;
  bufferMinutes: number;
}

export function ProductReferenceRotation({
  boardingMinutes,
  offBlockToOnBlockMinutes,
  deboardingMinutes,
  bufferMinutes,
}: ProductReferenceRotationProps) {
  const breakdown = deriveReferenceRotationBreakdown({
    boardingMinutes,
    offBlockToOnBlockMinutes,
    deboardingMinutes,
    bufferMinutes,
  });

  return (
    <section
      aria-label={`Referenz-Umlaufzeit ${breakdown.totalMinutes} Minuten`}
      className="reference-rotation-summary"
    >
      <div className="reference-rotation-heading">
        <strong>Referenz-Umlaufzeit</strong>
        <output aria-live="polite">{breakdown.totalMinutes} Min.</output>
      </div>
      <div className="reference-rotation-breakdown">
        <span aria-hidden="true" />
        <span>{breakdown.boardingMinutes} Min. Boarding</span>
        <span aria-hidden="true">+</span>
        <span>{breakdown.offBlockToOnBlockMinutes} Min. Offblock–Onblock</span>
        <span aria-hidden="true">+</span>
        <span>{breakdown.deboardingMinutes} Min. Ausstieg</span>
        <span aria-hidden="true">+</span>
        <span>{breakdown.bufferMinutes} Min. Puffer</span>
        <span aria-hidden="true">=</span>
        <strong>{breakdown.totalMinutes} Min. Umlauf</strong>
      </div>
      <p>Die Bodenzeiten gelten derzeit veranstaltungsweit für alle Produkte und Flugzeuge.</p>
    </section>
  );
}
