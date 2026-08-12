import {
  type AnalysisClientContext,
  type AnalysisUiEvent,
  analysisClientContextSchema,
} from "@rundflug/contracts";

const MAX_RECENT_UI_EVENTS = 100;
const recentEvents: AnalysisUiEvent[] = [];

export function recordAnalysisUiEvent(event: AnalysisUiEvent): void {
  recentEvents.push(event);
  if (recentEvents.length > MAX_RECENT_UI_EVENTS) {
    recentEvents.splice(0, recentEvents.length - MAX_RECENT_UI_EVENTS);
  }
}

export function recentAnalysisUiEvents(): AnalysisUiEvent[] {
  return structuredClone(recentEvents);
}

export function clearAnalysisUiEventsForTest(): void {
  recentEvents.splice(0, recentEvents.length);
}

function parseMajorVersion(input: string, versionStart: number): number | null {
  let versionEnd = versionStart;
  while (true) {
    const character = input[versionEnd];
    if (character === undefined || character < "0" || character > "9") break;
    versionEnd += 1;
  }
  const value = Number.parseInt(input.slice(versionStart, versionEnd), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function matchesRequiredMarker(
  input: string,
  requiredMarker: string | undefined,
  versionStart: number,
): boolean {
  return requiredMarker === undefined || input.includes(requiredMarker, versionStart);
}

export function browserVersion(input: string): {
  family: AnalysisClientContext["browserFamily"];
  majorVersion: number | null;
} {
  const candidates: ReadonlyArray<{
    family: AnalysisClientContext["browserFamily"];
    marker: string;
    requiredMarker?: string;
  }> = [
    { family: "EDGE", marker: "Edg/" },
    { family: "FIREFOX", marker: "Firefox/" },
    { family: "CHROME", marker: "Chrome/" },
    { family: "CHROME", marker: "CriOS/" },
    { family: "SAFARI", marker: "Version/", requiredMarker: "Safari" },
  ];
  for (const candidate of candidates) {
    const markerIndex = input.indexOf(candidate.marker);
    if (markerIndex < 0) continue;
    const versionStart = markerIndex + candidate.marker.length;
    if (!matchesRequiredMarker(input, candidate.requiredMarker, versionStart)) continue;
    return {
      family: candidate.family,
      majorVersion: parseMajorVersion(input, versionStart),
    };
  }
  return { family: "OTHER", majorVersion: null };
}

export function buildAnalysisClientContext(input: {
  route: string;
  selectedAircraftId: string | null;
  selectedRotationId: string | null;
  selectedQueueGroupIds: readonly string[];
  assignmentDialogOpen: boolean;
  visibleRecommendation: AnalysisClientContext["visibleRecommendation"];
  connectionState: AnalysisClientContext["connectionState"];
  capturedAt?: string;
}): AnalysisClientContext {
  const detected = browserVersion(navigator.userAgent);
  const displayMode = window.matchMedia("(display-mode: standalone)").matches ? "PWA" : "BROWSER";
  return analysisClientContextSchema.parse({
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    route: input.route,
    selectedAircraftId: input.selectedAircraftId,
    selectedRotationId: input.selectedRotationId,
    selectedQueueGroupIds: [...input.selectedQueueGroupIds],
    assignmentDialogOpen: input.assignmentDialogOpen,
    visibleRecommendation: input.visibleRecommendation,
    connectionState: input.connectionState,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    displayMode,
    browserFamily: detected.family,
    browserMajorVersion: detected.majorVersion,
    recentUiEvents: recentAnalysisUiEvents(),
  });
}
