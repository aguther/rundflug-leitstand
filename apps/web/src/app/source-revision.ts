const UNKNOWN_SOURCE_REVISION = "unknown";

export interface SourceRevisionMetadata {
  full: string;
  known: boolean;
  short: string;
}

export function createSourceRevisionMetadata(value: string | undefined): SourceRevisionMetadata {
  const full = value?.trim() || UNKNOWN_SOURCE_REVISION;
  const known = full.toLowerCase() !== UNKNOWN_SOURCE_REVISION;
  return {
    full,
    known,
    short: known ? full.slice(0, 7) : "unbekannt",
  };
}

const buildSourceRevision = createSourceRevisionMetadata(import.meta.env.SOURCE_REVISION);

export function getBuildSourceRevision(): SourceRevisionMetadata {
  return buildSourceRevision;
}
