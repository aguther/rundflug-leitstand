interface StoredDeviceRow {
  id: string;
  label: string;
  role: string;
  active: number;
  paired_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export interface DeviceReadProjection {
  id: string;
  label: string;
  role: string;
  active: boolean;
  online: boolean;
  pairedAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export async function loadDevices(
  database: D1Database,
  eventId: string,
  observedAt = Date.now(),
): Promise<DeviceReadProjection[]> {
  const devices = await database
    .prepare(
      `SELECT id, label, role, active, paired_at, last_seen_at, revoked_at
         FROM paired_devices WHERE operation_day_id = ?1 ORDER BY active DESC, paired_at DESC`,
    )
    .bind(eventId)
    .all<StoredDeviceRow>();

  return devices.results.map((entry) => ({
    id: entry.id,
    label: entry.label,
    role: entry.role,
    active: entry.active === 1,
    online: entry.active === 1 && observedAt - Date.parse(entry.last_seen_at) <= 120_000,
    pairedAt: entry.paired_at,
    lastSeenAt: entry.last_seen_at,
    revokedAt: entry.revoked_at,
  }));
}
