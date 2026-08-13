import { useEffect, useMemo, useRef, useState } from "react";
import type { SimulationResult } from "./model";

export const SIMULATION_FIDS_CHANNEL_NAME = "rundflug-simulation-fids:v1";
export const SIMULATION_FIDS_PROTOCOL_VERSION = 1;
export const SIMULATION_FIDS_HEARTBEAT_INTERVAL_MS = 1_000;
export const SIMULATION_FIDS_DISCONNECT_TIMEOUT_MS = 3_500;

const SOURCE_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const DISCOVERY_SETTLE_MS = 50;

interface SimulationFidsPlaybackState {
  clockMs: number;
  running: boolean;
  speed: number;
  visibleAt: number;
}

export interface SimulationFidsPublishedState extends SimulationFidsPlaybackState {
  result: SimulationResult;
}

interface SimulationFidsEnvelope {
  protocolVersion: typeof SIMULATION_FIDS_PROTOCOL_VERSION;
  sentAt: number;
}

export interface SimulationFidsStateMessage
  extends SimulationFidsEnvelope,
    SimulationFidsPublishedState {
  type: "STATE";
  sourceId: string;
}

export interface SimulationFidsTickMessage
  extends SimulationFidsEnvelope,
    SimulationFidsPlaybackState {
  type: "TICK";
  sourceId: string;
}

export interface SimulationFidsRequestMessage extends SimulationFidsEnvelope {
  type: "REQUEST_STATE";
  requestedSourceId: string | null;
}

export interface SimulationFidsStoppedMessage extends SimulationFidsEnvelope {
  type: "SOURCE_STOPPED";
  sourceId: string;
}

export type SimulationFidsChannelMessage =
  | SimulationFidsRequestMessage
  | SimulationFidsStateMessage
  | SimulationFidsStoppedMessage
  | SimulationFidsTickMessage;

export interface SimulationFidsConnectionState extends SimulationFidsPublishedState {
  connected: boolean;
  sourceId: string;
}

export interface SimulationFidsConnection {
  error: string | null;
  state: SimulationFidsConnectionState | null;
}

function normalizedSourceId(value: string | null): string | null {
  return value && SOURCE_ID_PATTERN.test(value) ? value : null;
}

function relativeLocation(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function resolveSimulationFidsSourceId(target: Window = window): string {
  const url = new URL(target.location.href);
  const existing = normalizedSourceId(url.searchParams.get("source"));
  if (existing) return existing;
  const sourceId = crypto.randomUUID();
  url.searchParams.set("source", sourceId);
  target.history.replaceState(null, "", relativeLocation(url));
  return sourceId;
}

export function simulationFidsHref(sourceId: string, target: Window = window): string {
  const sourceUrl = new URL(target.location.href);
  const targetUrl = new URL("/simulation/fids", sourceUrl.origin);
  targetUrl.searchParams.set("source", sourceId);
  for (const key of ["page", "setup"] as const) {
    const value = sourceUrl.searchParams.get(key);
    if (value) targetUrl.searchParams.set(key, value);
  }
  return `${targetUrl.pathname}${targetUrl.search}`;
}

function bindSourceInLocation(sourceId: string, target: Window): void {
  const url = new URL(target.location.href);
  url.searchParams.set("source", sourceId);
  target.history.replaceState(null, "", relativeLocation(url));
}

function isEnvelope(value: unknown): value is Record<string, unknown> & SimulationFidsEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).protocolVersion === SIMULATION_FIDS_PROTOCOL_VERSION &&
    typeof (value as Record<string, unknown>).sentAt === "number"
  );
}

export function isSimulationFidsChannelMessage(
  value: unknown,
): value is SimulationFidsChannelMessage {
  if (!isEnvelope(value) || typeof value.type !== "string") return false;
  if (value.type === "REQUEST_STATE") {
    return value.requestedSourceId === null || typeof value.requestedSourceId === "string";
  }
  if (
    (value.type !== "STATE" && value.type !== "TICK" && value.type !== "SOURCE_STOPPED") ||
    typeof value.sourceId !== "string"
  ) {
    return false;
  }
  if (value.type === "SOURCE_STOPPED") return true;
  const playback = value as Record<string, unknown>;
  const validPlayback =
    typeof playback.clockMs === "number" &&
    typeof playback.running === "boolean" &&
    typeof playback.speed === "number" &&
    typeof playback.visibleAt === "number";
  return value.type === "TICK"
    ? validPlayback
    : validPlayback &&
        typeof (value as Record<string, unknown>).result === "object" &&
        (value as Record<string, unknown>).result !== null;
}

function envelope(): SimulationFidsEnvelope {
  return {
    protocolVersion: SIMULATION_FIDS_PROTOCOL_VERSION,
    sentAt: Date.now(),
  };
}

function stateMessage(
  sourceId: string,
  state: SimulationFidsPublishedState,
): SimulationFidsStateMessage {
  return { ...envelope(), type: "STATE", sourceId, ...state };
}

function tickMessage(
  sourceId: string,
  state: SimulationFidsPublishedState,
): SimulationFidsTickMessage {
  return {
    ...envelope(),
    type: "TICK",
    sourceId,
    clockMs: state.clockMs,
    running: state.running,
    speed: state.speed,
    visibleAt: state.visibleAt,
  };
}

export function useSimulationFidsPublisher(state: SimulationFidsPublishedState): {
  fidsHref: string;
  sourceId: string;
} {
  const sourceId = useMemo(() => resolveSimulationFidsSourceId(), []);
  const latestState = useRef(state);
  const channel = useRef<BroadcastChannel | null>(null);
  const publishedResult = useRef(state.result);
  latestState.current = state;

  useEffect(() => {
    const nextChannel = new BroadcastChannel(SIMULATION_FIDS_CHANNEL_NAME);
    channel.current = nextChannel;
    const publishState = () => nextChannel.postMessage(stateMessage(sourceId, latestState.current));
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!isSimulationFidsChannelMessage(event.data) || event.data.type !== "REQUEST_STATE") {
        return;
      }
      if (event.data.requestedSourceId && event.data.requestedSourceId !== sourceId) return;
      publishState();
    };
    nextChannel.addEventListener("message", handleMessage);
    publishState();
    const heartbeat = window.setInterval(
      () => nextChannel.postMessage(tickMessage(sourceId, latestState.current)),
      SIMULATION_FIDS_HEARTBEAT_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(heartbeat);
      nextChannel.removeEventListener("message", handleMessage);
      nextChannel.postMessage({
        ...envelope(),
        type: "SOURCE_STOPPED",
        sourceId,
      } satisfies SimulationFidsStoppedMessage);
      nextChannel.close();
      if (channel.current === nextChannel) channel.current = null;
    };
  }, [sourceId]);

  useEffect(() => {
    if (publishedResult.current === state.result) return;
    publishedResult.current = state.result;
    channel.current?.postMessage(stateMessage(sourceId, latestState.current));
  }, [sourceId, state.result]);

  return {
    fidsHref: simulationFidsHref(sourceId),
    sourceId,
  };
}

function requestedSourceId(target: Window): string | null {
  return normalizedSourceId(new URL(target.location.href).searchParams.get("source"));
}

export function useSimulationFidsConnection(target: Window = window): SimulationFidsConnection {
  const [state, setState] = useState<SimulationFidsConnectionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boundSource = useRef(requestedSourceId(target));
  const candidate = useRef<SimulationFidsStateMessage | null>(null);
  const discoveryTimer = useRef<number | null>(null);
  const lastSeenAt = useRef(0);

  useEffect(() => {
    let active = true;
    let nextChannel: BroadcastChannel;
    try {
      nextChannel = new BroadcastChannel(SIMULATION_FIDS_CHANNEL_NAME);
    } catch {
      setError("Dieser Browser unterstützt die lokale Verbindung zum Simulator nicht.");
      return;
    }

    const acceptState = (message: SimulationFidsStateMessage, bind: boolean) => {
      if (!active) return;
      if (bind) {
        boundSource.current = message.sourceId;
        bindSourceInLocation(message.sourceId, target);
      }
      lastSeenAt.current = Date.now();
      setState({
        connected: true,
        sourceId: message.sourceId,
        result: message.result,
        clockMs: message.clockMs,
        running: message.running,
        speed: message.speed,
        visibleAt: message.visibleAt,
      });
    };

    const scheduleCandidate = (message: SimulationFidsStateMessage) => {
      if (!candidate.current || message.sentAt >= candidate.current.sentAt) {
        candidate.current = message;
      }
      if (discoveryTimer.current !== null) return;
      discoveryTimer.current = target.setTimeout(() => {
        discoveryTimer.current = null;
        const selected = candidate.current;
        candidate.current = null;
        if (selected) acceptState(selected, true);
      }, DISCOVERY_SETTLE_MS);
    };

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!isSimulationFidsChannelMessage(event.data)) return;
      const message = event.data;
      if (message.type === "REQUEST_STATE") return;
      const selectedSource = boundSource.current;
      if (message.type === "STATE" && !selectedSource) {
        scheduleCandidate(message);
        return;
      }
      if (message.sourceId !== selectedSource) return;
      if (message.type === "SOURCE_STOPPED") {
        lastSeenAt.current = 0;
        setState((current) => (current ? { ...current, connected: false } : current));
        return;
      }
      lastSeenAt.current = Date.now();
      if (message.type === "STATE") {
        acceptState(message, false);
        return;
      }
      setState((current) =>
        current
          ? {
              ...current,
              connected: true,
              clockMs: message.clockMs,
              running: message.running,
              speed: message.speed,
              visibleAt: message.visibleAt,
            }
          : current,
      );
    };

    nextChannel.addEventListener("message", handleMessage);
    nextChannel.postMessage({
      ...envelope(),
      type: "REQUEST_STATE",
      requestedSourceId: boundSource.current,
    } satisfies SimulationFidsRequestMessage);
    const connectionMonitor = target.setInterval(() => {
      if (
        lastSeenAt.current > 0 &&
        Date.now() - lastSeenAt.current > SIMULATION_FIDS_DISCONNECT_TIMEOUT_MS
      ) {
        lastSeenAt.current = 0;
        setState((current) => (current ? { ...current, connected: false } : current));
      }
    }, SIMULATION_FIDS_HEARTBEAT_INTERVAL_MS);

    return () => {
      active = false;
      if (discoveryTimer.current !== null) target.clearTimeout(discoveryTimer.current);
      target.clearInterval(connectionMonitor);
      nextChannel.removeEventListener("message", handleMessage);
      nextChannel.close();
    };
  }, [target]);

  return { error, state };
}
