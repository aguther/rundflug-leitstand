import type { OperationBoard } from "@rundflug/contracts";
import { useState } from "react";
import {
  manifestCorrectionCandidates,
  manifestCorrectionTargets,
} from "../../../admin-manifest-correction";
import { ValidationHint } from "../../../admin-ux";
import { Button } from "../../../design-system/components";
import { FieldLabel, rotationStatusLabel } from "../../../operation-workspace";

interface ManifestCorrectionPanelProps {
  administrator: boolean;
  board: OperationBoard;
  busy: boolean;
  onCorrect: (ticketGroupId: string, targetRotationId: string, reason: string) => void;
}

export function ManifestCorrectionPanel({
  administrator,
  board,
  busy,
  onCorrect,
}: ManifestCorrectionPanelProps) {
  const [ticketGroupId, setTicketGroupId] = useState("");
  const [targetRotationId, setTargetRotationId] = useState("");
  const [reason, setReason] = useState("");
  const candidates = manifestCorrectionCandidates(board.rotations);
  const selectedCandidate = candidates.find(
    (candidate) => candidate.ticketGroupId === ticketGroupId,
  );
  const targets = manifestCorrectionTargets(board.rotations, selectedCandidate);

  return (
    <section className="admin-section manifest-correction">
      <div className="section-heading">
        <div>
          <h2>Dokumentierte Besetzung korrigieren</h2>
          <p>
            Eine anonyme Buchungsgruppe wird immer vollständig einem bereits gestarteten oder
            abgeschlossenen Umlauf zugeordnet.
          </p>
        </div>
        <span className="admin-only-badge">Nur Administration</span>
      </div>
      <ValidationHint>
        Diese Korrektur berichtigt ausschließlich die Dokumentation und besitzt keine
        flugbetriebliche oder sicherheitsbezogene Freigabewirkung.
      </ValidationHint>
      <div className="manifest-correction-grid">
        <div className="field-control">
          <FieldLabel
            htmlFor="manifest-ticket-group"
            label="Zu korrigierende Buchungsgruppe"
            help="Nur anonyme Gruppen mit bereits gestartetem oder abgeschlossenem dokumentiertem Umlauf."
          />
          <select
            id="manifest-ticket-group"
            onChange={(event) => {
              setTicketGroupId(event.target.value);
              setTargetRotationId("");
            }}
            value={ticketGroupId}
          >
            <option value="">Bitte wählen</option>
            {candidates.map((candidate) => (
              <option key={candidate.ticketGroupId} value={candidate.ticketGroupId}>
                {candidate.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-control">
          <FieldLabel
            htmlFor="manifest-target-rotation"
            label="Tatsächlicher Zielumlauf"
            help="Der Zielumlauf muss mindestens den Status Im Flug erreicht haben."
          />
          <select
            disabled={!selectedCandidate}
            id="manifest-target-rotation"
            onChange={(event) => setTargetRotationId(event.target.value)}
            value={targetRotationId}
          >
            <option value="">Bitte wählen</option>
            {targets.map((rotation) => (
              <option key={rotation.id} value={rotation.id}>
                {rotation.communicationLabel} · {rotationStatusLabel[rotation.status]}
              </option>
            ))}
          </select>
        </div>
        <div className="field-control manifest-reason-field">
          <FieldLabel
            htmlFor="manifest-correction-reason"
            label="Dokumentationsgrund"
            help="Mindestens 10 Zeichen; Grund, Quelle, Ziel, Gerät und Version werden auditiert."
          />
          <textarea
            id="manifest-correction-reason"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Tatsächliche Besetzung nach Rückmeldung berichtigen"
            value={reason}
          />
          <small>{reason.trim().length}/10 Mindestzeichen</small>
        </div>
      </div>
      {selectedCandidate ? (
        <div className="manifest-correction-preview">
          <div>
            <span>Bisher dokumentiert</span>
            <strong>{selectedCandidate.label}</strong>
          </div>
          <span aria-hidden="true">→</span>
          <div>
            <span>Wird vollständig zugeordnet zu</span>
            <strong>
              {targets.find((rotation) => rotation.id === targetRotationId)?.communicationLabel ??
                "Zielumlauf wählen"}
            </strong>
          </div>
        </div>
      ) : null}
      <Button
        busy={busy}
        className="primary-action manifest-correction-action"
        disabled={
          busy || !administrator || !ticketGroupId || !targetRotationId || reason.trim().length < 10
        }
        onClick={() => onCorrect(ticketGroupId, targetRotationId, reason.trim())}
        type="button"
        variant="primary"
      >
        Besetzung protokolliert korrigieren
      </Button>
      {candidates.length === 0 ? (
        <p className="help-text">Aktuell ist keine Korrektur nach Flugstart erforderlich.</p>
      ) : null}
    </section>
  );
}
