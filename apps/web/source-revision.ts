export const UNKNOWN_SOURCE_REVISION = "unknown";

export function resolveSourceRevision(
  configuredRevision: string | undefined,
  readGitRevision: () => string,
): string {
  const configured = configuredRevision?.trim();
  if (configured) return configured;

  try {
    return readGitRevision().trim() || UNKNOWN_SOURCE_REVISION;
  } catch {
    return UNKNOWN_SOURCE_REVISION;
  }
}
