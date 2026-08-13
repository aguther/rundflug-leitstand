import { Button, ModalDialog } from "../../design-system/components";
import type { BatchComparisonResult } from "./comparison";

interface SimulationComparisonDialogProps {
  error: string | null;
  onCancel: () => void;
  onClose: () => void;
  onRestart: () => void;
  open: boolean;
  progress: { completed: number; total: number };
  result: BatchComparisonResult | null;
  running: boolean;
}

function metric(value: number | null, unit = ""): string {
  if (value === null) return "–";
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value)}${unit}`;
}

function comparisonDeltaLabel(row: BatchComparisonResult["rows"][number]): string {
  if (row.delta === null) return "–";
  const prefix = row.delta > 0 ? "+" : "";
  const unit = row.unit ? ` ${row.unit}` : "";
  return `${prefix}${metric(row.delta, unit)}`;
}

export function SimulationComparisonDialog({
  error,
  onCancel,
  onClose,
  onRestart,
  open,
  progress,
  result,
  running,
}: Readonly<SimulationComparisonDialogProps>) {
  return (
    <ModalDialog
      description="Produktions-Baseline und lokaler Kandidat verwenden dieselben Seeds und Szenarien."
      footer={
        <>
          {running ? (
            <Button onClick={onCancel}>Vergleich abbrechen</Button>
          ) : (
            <Button onClick={onRestart}>Erneut ausführen</Button>
          )}
          <Button onClick={onClose} variant="primary">
            Schließen
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      size="wide"
      title="A/B-Prognosevergleich"
    >
      {running ? (
        <section className="sim-comparison-progress" aria-live="polite">
          <strong>
            Seed-Lauf {progress.completed} von {progress.total}
          </strong>
          <progress max={Math.max(1, progress.total)} value={progress.completed} />
          <p>Die Berechnung läuft ausschließlich lokal in einem Browser-Worker.</p>
        </section>
      ) : null}
      {error ? (
        <p className="sim-editor-errors" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <>
          <p className="sim-comparison-summary">
            Median je Kennzahl über {result.runCount} Läufe ab Seed {result.seedStart}. Ein
            positives Delta bedeutet Kandidat minus Baseline.
          </p>
          <div className="sim-comparison-table-wrap">
            <table className="sim-comparison-table">
              <thead>
                <tr>
                  <th>Kategorie</th>
                  <th>Kennzahl</th>
                  <th>Baseline</th>
                  <th>Kandidat</th>
                  <th>Delta</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.category}</td>
                    <th scope="row">{row.label}</th>
                    <td>{metric(row.baseline, row.unit ? ` ${row.unit}` : "")}</td>
                    <td>{metric(row.candidate, row.unit ? ` ${row.unit}` : "")}</td>
                    <td>{comparisonDeltaLabel(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sim-editor-hint">
            Die Tabelle spricht keine automatische Empfehlung aus: Fehler, Fensterbreite, Qualität
            und Gate-Wartezeit sind getrennte Zielgrößen.
          </p>
        </>
      ) : null}
    </ModalDialog>
  );
}
