import type { MasterDataTemplate } from "@rundflug/contracts";

interface ExistingTemplateAircraftRow {
  id: string;
  registration: string;
  aircraft_type: string;
  passenger_seats: number;
  maximum_passenger_payload_kg: number | null;
  refuel_reminder_threshold: number;
}

export async function validateTemplateAircraft(
  database: D1Database,
  template: MasterDataTemplate,
): Promise<{
  existingByRegistration: Map<string, ExistingTemplateAircraftRow>;
  errors: Array<{ path: string; message: string }>;
}> {
  const registrations = template.aircraft.map((aircraft) => aircraft.registration);
  const existingRows =
    registrations.length === 0
      ? []
      : (
          await database
            .prepare(
              `SELECT id, registration, aircraft_type, passenger_seats,
                      maximum_passenger_payload_kg, refuel_reminder_threshold
                 FROM aircraft
                WHERE registration IN (SELECT value FROM json_each(?1))`,
            )
            .bind(JSON.stringify(registrations))
            .all<ExistingTemplateAircraftRow>()
        ).results;
  const existingByRegistration = new Map(
    existingRows.map((existing) => [existing.registration, existing]),
  );
  const errors: Array<{ path: string; message: string }> = [];
  for (const [index, aircraft] of template.aircraft.entries()) {
    const existing = existingByRegistration.get(aircraft.registration);
    if (!existing) continue;
    if (
      existing.aircraft_type !== aircraft.aircraftType ||
      existing.passenger_seats !== aircraft.passengerSeats ||
      existing.maximum_passenger_payload_kg !== aircraft.maximumPassengerPayloadKg ||
      existing.refuel_reminder_threshold !== aircraft.refuelReminderThreshold
    ) {
      errors.push({
        path: `aircraft.${index}`,
        message: `Flugzeug ${aircraft.registration} existiert bereits mit abweichenden Stammdaten.`,
      });
    }
  }
  return { existingByRegistration, errors };
}
