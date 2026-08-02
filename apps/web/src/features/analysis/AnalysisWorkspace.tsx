import type { AnalysisArchive, OperationBoard } from "@rundflug/contracts";
import { Archive, Download, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  createAnalysisArchive,
  deleteAnalysisArchive,
  downloadAnalysisArchive,
  downloadAnalysisSnapshot,
  listAnalysisArchives,
} from "../../api";
import { Button, ConfirmationDialog, StatusPill, Tabs } from "../../design-system/components";
import { ADMIN_DEVICE_ID, deviceTokenFor } from "../../operation-workspace";
import { buildAnalysisClientContext, recordAnalysisUiEvent } from "./analysis-client-diagnostics";
import "./analysis-workspace.css";

type EvaluationTab = "analysis" | "simulation";

const evaluationTabs: Array<{ value: EvaluationTab; label: string }> = [
  { value: "analysis", label: "Analyse und Diagnose" },
  { value: "simulation", label: "Prognose-Simulator" },
];

const archiveStatus: Record<
  AnalysisArchive["status"],
  { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }
> = {
  PENDING: { label: "Wird vorbereitet", tone: "info" },
  BUILDING: { label: "Wird erstellt", tone: "info" },
  READY: { label: "Bereit", tone: "success" },
  FAILED: { label: "Fehlgeschlagen", tone: "danger" },
  EXPIRED: { label: "Abgelaufen", tone: "neutral" },
  DELETED: { label: "Gelöscht", tone: "neutral" },
};

function formatBytes(value: number | null): string {
  if (value === null) return "–";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatTimestamp(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(
        new Date(value),
      )
    : "–";
}

export function AnalysisWorkspace({
  board,
  backendConfirmed,
  onRefresh,
  simulator,
}: {
  board: OperationBoard | null;
  backendConfirmed: boolean;
  onRefresh: () => void | Promise<void>;
  simulator: ReactNode;
}) {
  const [tab, setTab] = useState<EvaluationTab>("analysis");
  const [exportBusy, setExportBusy] = useState(false);
  const [archives, setArchives] = useState<AnalysisArchive[]>([]);
  const [archivesLoading, setArchivesLoading] = useState(false);
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<AnalysisArchive | null>(null);
  const [status, setStatus] = useState<{
    tone: "success" | "error" | "neutral";
    text: string;
    stale: boolean;
  }>({ tone: "neutral", text: "", stale: false });

  const loadArchives = useCallback(async () => {
    if (!board) {
      setArchives([]);
      return;
    }
    setArchivesLoading(true);
    try {
      setArchives(
        await listAnalysisArchives(
          board.event.eventId,
          ADMIN_DEVICE_ID,
          deviceTokenFor(ADMIN_DEVICE_ID),
        ),
      );
      setArchiveError("");
    } catch {
      setArchiveError("Tagesarchive konnten nicht geladen werden.");
    } finally {
      setArchivesLoading(false);
    }
  }, [board]);

  useEffect(() => {
    void loadArchives();
  }, [loadArchives]);

  useEffect(() => {
    if (
      !archives.some((archive) => archive.status === "PENDING" || archive.status === "BUILDING")
    ) {
      return;
    }
    const timer = window.setInterval(() => void loadArchives(), 3000);
    return () => window.clearInterval(timer);
  }, [archives, loadArchives]);

  async function requestArchive() {
    if (!board || archiveBusyId) return;
    setArchiveBusyId("create");
    try {
      const archive = await createAnalysisArchive(
        board.event.eventId,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        board.event.version,
      );
      setArchives((current) => [archive, ...current.filter((item) => item.id !== archive.id)]);
      setArchiveError("");
    } catch (error) {
      setArchiveError(
        error instanceof Error ? error.message : "Tagesarchiv konnte nicht erstellt werden.",
      );
    } finally {
      setArchiveBusyId(null);
    }
  }

  async function downloadArchive(archive: AnalysisArchive) {
    if (!board || archiveBusyId) return;
    setArchiveBusyId(archive.id);
    try {
      await downloadAnalysisArchive(
        board.event.eventId,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        archive,
      );
      setArchiveError("");
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "Tagesarchiv nicht verfügbar.");
    } finally {
      setArchiveBusyId(null);
    }
  }

  async function confirmDeleteArchive() {
    if (!board || !deleteCandidate || archiveBusyId) return;
    const archive = deleteCandidate;
    setArchiveBusyId(archive.id);
    try {
      const updated = await deleteAnalysisArchive(
        board.event.eventId,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        archive.id,
      );
      setArchives((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setDeleteCandidate(null);
      setArchiveError("");
    } catch (error) {
      setArchiveError(
        error instanceof Error ? error.message : "Tagesarchiv konnte nicht gelöscht werden.",
      );
    } finally {
      setArchiveBusyId(null);
    }
  }

  async function exportSnapshot() {
    if (!board || exportBusy || !backendConfirmed) return;
    setExportBusy(true);
    setStatus({ tone: "neutral", text: "Momentaufnahme wird vorbereitet …", stale: false });
    recordAnalysisUiEvent({
      type: "ANALYSIS_EXPORT_STARTED",
      occurredAt: new Date().toISOString(),
    });
    try {
      const clientContext = buildAnalysisClientContext({
        route: window.location.pathname,
        selectedAircraftId: null,
        selectedRotationId: null,
        selectedQueueGroupIds: [],
        assignmentDialogOpen: false,
        visibleRecommendation: null,
        connectionState: "CONNECTED",
      });
      await downloadAnalysisSnapshot(
        board.event.eventId,
        ADMIN_DEVICE_ID,
        deviceTokenFor(ADMIN_DEVICE_ID),
        board.event.version,
        clientContext,
      );
      recordAnalysisUiEvent({
        type: "ANALYSIS_EXPORT_COMPLETED",
        occurredAt: new Date().toISOString(),
      });
      setStatus({
        tone: "success",
        text: "Momentaufnahme wurde heruntergeladen.",
        stale: false,
      });
    } catch (error) {
      recordAnalysisUiEvent({
        type: "ANALYSIS_EXPORT_FAILED",
        occurredAt: new Date().toISOString(),
      });
      const message = error instanceof Error ? error.message : "Diagnoseexport fehlgeschlagen.";
      const stale = /geändert|Version|aktualisiert/i.test(message);
      setStatus({
        tone: "error",
        text: stale
          ? "Der Betriebsstand hat sich geändert. Ansicht aktualisieren und Export erneut starten."
          : "Die Momentaufnahme konnte nicht erstellt werden. Bitte erneut versuchen.",
        stale,
      });
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <section className="analysis-workspace">
      <Tabs
        idPrefix="admin-evaluation"
        items={evaluationTabs}
        label="Auswertungsbereich"
        onChange={setTab}
        value={tab}
      />
      <div
        aria-labelledby="admin-evaluation-analysis-tab"
        className="analysis-workspace-panel"
        hidden={tab !== "analysis"}
        id="admin-evaluation-analysis-panel"
        role="tabpanel"
      >
        {board ? (
          <>
            <div className="analysis-event-context">
              <strong>{board.event.eventDate}</strong>
              <span>{board.event.status}</span>
              <span>{board.event.timeZone}</span>
              <span>Version {board.event.version}</span>
            </div>
            <section className="analysis-snapshot-toolbar">
              <div className="analysis-snapshot-copy">
                <div className="analysis-snapshot-title">
                  <h2>Diagnose-Momentaufnahme</h2>
                  <StatusPill tone="neutral">
                    <ShieldCheck aria-hidden="true" /> Support-sicher
                  </StatusPill>
                </div>
                <p>Aktueller Betriebs- und Planungsstand für die technische Analyse</p>
              </div>
              <div className="analysis-snapshot-action-slot">
                <Button
                  aria-busy={exportBusy}
                  busy={exportBusy}
                  disabled={!backendConfirmed || exportBusy}
                  onClick={() => void exportSnapshot()}
                  type="button"
                  variant="primary"
                >
                  <Download aria-hidden="true" /> Aktuelle Momentaufnahme exportieren
                </Button>
              </div>
              <div aria-live="polite" className={`analysis-snapshot-status tone-${status.tone}`}>
                <span>{status.text}</span>
                {status.stale ? (
                  <Button onClick={() => void onRefresh()} size="compact" type="button">
                    Aktualisieren
                  </Button>
                ) : null}
              </div>
            </section>
            <section className="analysis-archives">
              <div className="analysis-archives-header">
                <div>
                  <h2>Tagesanalysepakete</h2>
                  <p>Vollständige, replayfähige Pakete sind erst nach dem Schließen verfügbar.</p>
                </div>
                <div className="analysis-archives-header-actions">
                  <Button
                    aria-label="Tagesarchive aktualisieren"
                    disabled={archivesLoading}
                    onClick={() => void loadArchives()}
                    size="compact"
                    type="button"
                    variant="ghost"
                  >
                    <RefreshCw aria-hidden="true" /> Aktualisieren
                  </Button>
                  <Button
                    busy={archiveBusyId === "create"}
                    disabled={
                      !backendConfirmed ||
                      archiveBusyId !== null ||
                      !["CLOSED", "ARCHIVED"].includes(board.event.status)
                    }
                    onClick={() => void requestArchive()}
                    type="button"
                  >
                    <Archive aria-hidden="true" />
                    {archives.some((archive) => archive.status === "FAILED")
                      ? "Erneut versuchen"
                      : "Tagespaket erstellen"}
                  </Button>
                </div>
              </div>
              <div aria-live="polite" className="analysis-archives-message">
                {archiveError ||
                  (!["CLOSED", "ARCHIVED"].includes(board.event.status)
                    ? "Der aktuelle Tag ist noch geöffnet."
                    : archivesLoading
                      ? "Archive werden geladen …"
                      : "")}
              </div>
              <section
                aria-label="Liste der Tagesanalysepakete"
                className="analysis-archives-table-scroll"
              >
                <table className="analysis-archives-table">
                  <thead>
                    <tr>
                      <th scope="col">Status</th>
                      <th scope="col">Version</th>
                      <th scope="col">Erstellt</th>
                      <th scope="col">Größe</th>
                      <th scope="col">Verfügbar bis</th>
                      <th scope="col">
                        <span className="sr-only">Aktionen</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {archives.length === 0 ? (
                      <tr>
                        <td className="analysis-archives-empty" colSpan={6}>
                          Noch kein Tagesanalysepaket vorhanden.
                        </td>
                      </tr>
                    ) : (
                      archives.map((archive) => (
                        <tr key={archive.id}>
                          <td>
                            <StatusPill tone={archiveStatus[archive.status].tone}>
                              {archiveStatus[archive.status].label}
                            </StatusPill>
                          </td>
                          <td>{archive.eventVersion}</td>
                          <td>{formatTimestamp(archive.completedAt ?? archive.requestedAt)}</td>
                          <td>{formatBytes(archive.sizeBytes)}</td>
                          <td>{formatTimestamp(archive.expiresAt)}</td>
                          <td>
                            <div className="analysis-archive-actions">
                              <Button
                                aria-label={`Tagespaket Version ${archive.eventVersion} herunterladen`}
                                busy={archiveBusyId === archive.id && archive.status === "READY"}
                                disabled={archive.status !== "READY" || archiveBusyId !== null}
                                onClick={() => void downloadArchive(archive)}
                                size="compact"
                                type="button"
                                variant="ghost"
                              >
                                <Download aria-hidden="true" /> Laden
                              </Button>
                              <Button
                                aria-label={`Tagespaket Version ${archive.eventVersion} löschen`}
                                disabled={
                                  archiveBusyId !== null ||
                                  archive.status === "BUILDING" ||
                                  archive.status === "DELETED"
                                }
                                onClick={() => setDeleteCandidate(archive)}
                                size="compact"
                                type="button"
                                variant="ghost"
                              >
                                <Trash2 aria-hidden="true" /> Löschen
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </section>
            </section>
            <ConfirmationDialog
              body="Die Archivdatei wird aus dem Analysespeicher entfernt. Die Löschung selbst bleibt im Zugriffsprotokoll nachvollziehbar."
              confirmBusy={archiveBusyId === deleteCandidate?.id}
              confirmLabel="Tagespaket löschen"
              danger
              onCancel={() => setDeleteCandidate(null)}
              onConfirm={confirmDeleteArchive}
              open={deleteCandidate !== null}
              title="Tagesanalysepaket löschen?"
            />
          </>
        ) : (
          <div className="analysis-empty-state">
            <h2>Keine Veranstaltung ausgewählt</h2>
            <p>Wähle eine Veranstaltung aus, um eine Diagnose zu erstellen.</p>
          </div>
        )}
      </div>
      <div
        aria-labelledby="admin-evaluation-simulation-tab"
        className="analysis-workspace-panel"
        hidden={tab !== "simulation"}
        id="admin-evaluation-simulation-panel"
        role="tabpanel"
      >
        {simulator}
      </div>
    </section>
  );
}
