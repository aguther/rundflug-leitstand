const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export function attendanceJson(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", JSON_HEADERS["content-type"]);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function ticketStatusForAttendance(checkedIn: boolean, rotationStatus: string): string {
  if (checkedIn) return rotationStatus === "CALLED" ? "BOARDING" : "CHECKED_IN";
  return rotationStatus === "CALLED" ? "CALLED" : "QUEUED";
}

export function ticketGroupStatusForAttendance(checkedIn: boolean, rotationStatus: string): string {
  if (checkedIn) return rotationStatus === "DRAFT" ? "CHECKED_IN" : "BOARDING";
  return rotationStatus === "DRAFT" ? "QUEUED" : "CALLED";
}
