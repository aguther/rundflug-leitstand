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

export function browserVersion(input: string): {
  family: AnalysisClientContext["browserFamily"];
  majorVersion: number | null;
} {
  const candidates: Array<{
    family: AnalysisClientContext["browserFamily"];
    pattern: RegExp;
  }> = [
    { family: "EDGE", pattern: /Edg\/(\d+)/ },
    { family: "FIREFOX", pattern: /Firefox\/(\d+)/ },
    { family: "CHROME", pattern: /(?:Chrome|CriOS)\/(\d+)/ },
    { family: "SAFARI", pattern: /Version\/(\d+).*Safari/ },
  ];
  for (const candidate of candidates) {
    const match = input.match(candidate.pattern);
    if (match) {
      const value = Number.parseInt(match[1] ?? "", 10);
      return {
        family: candidate.family,
        majorVersion: Number.isSafeInteger(value) && value > 0 ? value : null,
      };
    }
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
