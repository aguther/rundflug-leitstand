export type AdminStatusTone = "danger" | "neutral" | "success" | "warning";

export function getAdminStatusPresentation(
  status: string | undefined,
  loadError: string | null,
): {
  label: string;
  tone: AdminStatusTone;
} {
  let tone: AdminStatusTone = "neutral";
  if (status === "ACTIVE") tone = "success";
  else if (status === "PREPARATION") tone = "warning";
  else if (loadError) tone = "danger";

  switch (status) {
    case "ACTIVE":
      return { label: "Betrieb aktiv", tone };
    case "PREPARATION":
      return { label: "Betrieb noch nicht freigegeben", tone };
    case "CLOSED":
      return { label: "Betrieb geschlossen", tone };
    default:
      return { label: loadError ? "Stand nicht verfügbar" : "Stand wird geladen", tone };
  }
}
