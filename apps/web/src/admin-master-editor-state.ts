const draftCollator = new Intl.Collator("de-DE", {
  numeric: true,
  sensitivity: "base",
});

export function createMasterEditorSnapshot(values: readonly unknown[]): string {
  return JSON.stringify(
    values.map((value) =>
      Array.isArray(value) ? [...value].map(String).toSorted(draftCollator.compare) : value,
    ),
  );
}

export function hasMasterEditorChanges(
  initialSnapshot: string | null,
  currentSnapshot: string,
): boolean {
  return initialSnapshot !== null && initialSnapshot !== currentSnapshot;
}
