export const publicStatusLabel = {
  WAITING: "Warten",
  PREPARE: "Bereithalten",
  COME_TO_FLIGHT_LINE: "Bitte zur Flight Line",
  BOARDING: "Boarding",
  IN_FLIGHT: "Flug läuft",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
  SERVICE_PAUSED: "Organisatorischer Betrieb pausiert",
} as const;

export const capacityLabel = {
  AVAILABLE: "Kapazität verfügbar",
  LIMITED: "Nur noch begrenzt verfügbar",
  MANUAL_REVIEW: "Manuelle Prüfung erforderlich",
  SOLD_OUT: "Keine sichere Restkapazität",
} as const;

export const rotationStatusLabel = {
  DRAFT: "Vorbereitung",
  CALLED: "Aufgerufen",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet",
  COMPLETED: "Abgeschlossen",
} as const;

export const predictionQualityLabel = {
  STABLE: "stabil",
  CHANGING: "in Veränderung",
  UNCERTAIN: "unsicher",
} as const;

export const aircraftStateLabel = {
  AVAILABLE: "Verfügbar",
  BOARDING: "Boarding",
  IN_FLIGHT: "Im Flug",
  LANDED: "Gelandet / Deboarding",
  TURNAROUND: "Bodenprozess",
  REFUELING: "Tanken aktuell",
  PAUSED: "Pause",
  INTERRUPTED: "Flugbetrieb unterbrochen",
  INACTIVE: "Kurzfristig inaktiv",
} as const;

export const weightClassLabel: Record<WeightClass, string> = {
  NOT_CAPTURED: "Nicht erfassen",
  CHILD: "Kind",
  NORMAL: "Normal",
  HEAVY: "Schwer",
  INDIVIDUAL: "Individuell",
};

export type WeightClass = "NOT_CAPTURED" | "CHILD" | "NORMAL" | "HEAVY" | "INDIVIDUAL";

export function operationalTimeLabel(value: string | null, timeZone: string): string {
  if (!value) return "–";
  return new Date(value).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}
