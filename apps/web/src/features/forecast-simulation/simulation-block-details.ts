export function simulationBlockDetails(
  input: {
    dayOutage: boolean;
    durationMinutes: number;
    source: "AUTOMATIC" | "MANUAL" | "PRESET";
  },
  durationMinutes = input.durationMinutes,
): string {
  if (input.dayOutage) {
    return "Simulierter Tagesausfall an zulässiger organisatorischer Grenze bestätigt.";
  }
  const source = input.source === "AUTOMATIC" ? "Automatisch erzeugte" : "Manuell injizierte";
  return `${source} Sperre für ${durationMinutes} Minuten.`;
}
