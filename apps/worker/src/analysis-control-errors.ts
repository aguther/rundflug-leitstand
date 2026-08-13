export function snapshotCaptureFailure(code: string): {
  status: 403 | 409 | 412 | 500;
  message: string;
} {
  if (code === "SESSION_NOT_AUTHORIZED") {
    return { status: 403, message: "Für die Diagnose ist eine berechtigte Sitzung erforderlich." };
  }
  if (code === "ANALYSIS_SNAPSHOT_STALE_VERSION") {
    return { status: 412, message: "Die Betriebsdaten wurden inzwischen aktualisiert." };
  }
  if (code === "ANALYSIS_SNAPSHOT_CAPTURE_FAILED") {
    return { status: 500, message: "Der aktuelle Planungslauf konnte nicht erstellt werden." };
  }
  if (code === "ANALYSIS_SNAPSHOT_IDEMPOTENCY_CONFLICT") {
    return {
      status: 409,
      message: "Die Diagnoseanforderung wurde bereits mit anderen Daten verwendet.",
    };
  }
  return { status: 409, message: "Der aktuelle Planungslauf konnte nicht erstellt werden." };
}

export function safeSnapshotBuildError(error: unknown): {
  code: string;
  message: string;
} {
  const code = error instanceof Error ? error.message : "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE";
  if (code === "ANALYSIS_SNAPSHOT_NOT_READY") {
    return { code, message: "Der aktuelle Planungslauf ist noch nicht verfügbar." };
  }
  if (["ANALYSIS_SNAPSHOT_CHANGED", "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE"].includes(code)) {
    return { code, message: "Die Diagnose konnte nicht konsistent aufgebaut werden." };
  }
  return {
    code: "ANALYSIS_SNAPSHOT_DATA_INCOMPLETE",
    message: "Die Diagnose konnte nicht konsistent aufgebaut werden.",
  };
}

export function archiveConflictMessage(code: string): string {
  if (code === "ANALYSIS_ARCHIVE_EVENT_OPEN") {
    return "Das Tagesarchiv kann erst nach dem Schließen erstellt werden.";
  }
  return "Die Veranstaltungsversion wurde inzwischen geändert.";
}
