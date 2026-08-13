export function nextEventSortDirection(direction: "asc" | "desc" | null): "asc" | "desc" | null {
  if (direction === "asc") return "desc";
  if (direction === "desc") return null;
  return "asc";
}
