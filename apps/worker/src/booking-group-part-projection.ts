import type { BookingGroupPartContext } from "@rundflug/domain";

export interface BookingGroupPartProjectionColumns {
  part_number: number | null;
  part_count: number | null;
  passenger_count: number | null;
}

const BOOKING_GROUP_PART_PROJECTION_CTE = `
WITH relevant_booking_group_rotations AS (
  SELECT ticket.ticket_group_id,
         assignment.rotation_id,
         COUNT(*) AS passenger_count,
         COALESCE(flight_group.queue_position, flight_group.communication_number) AS sort_position,
         rotation.created_at AS rotation_created_at
    FROM rotation_tickets assignment
    JOIN tickets ticket ON ticket.id = assignment.ticket_id
    JOIN rotations rotation ON rotation.id = assignment.rotation_id
    JOIN flight_groups flight_group ON flight_group.id = rotation.flight_group_id
   WHERE assignment.released_at IS NULL
     AND rotation.status <> 'CANCELED'
   GROUP BY ticket.ticket_group_id, assignment.rotation_id,
            COALESCE(flight_group.queue_position, flight_group.communication_number),
            rotation.created_at
),
booking_group_parts AS (
  SELECT ticket_group_id,
         rotation_id,
         passenger_count,
         ROW_NUMBER() OVER (
           PARTITION BY ticket_group_id
           ORDER BY sort_position, rotation_created_at, rotation_id
         ) AS part_number,
         COUNT(*) OVER (PARTITION BY ticket_group_id) AS part_count
    FROM relevant_booking_group_rotations
)
`;

export function withBookingGroupPartProjection(statement: string): string {
  const trimmedStatement = statement.trimStart();
  if (trimmedStatement.startsWith("WITH ")) {
    return `${BOOKING_GROUP_PART_PROJECTION_CTE},${trimmedStatement.slice("WITH".length)}`;
  }
  return `${BOOKING_GROUP_PART_PROJECTION_CTE}${statement}`;
}

export function bookingGroupPartContextFromColumns(
  columns: BookingGroupPartProjectionColumns,
): BookingGroupPartContext | null {
  if (
    columns.part_number === null ||
    columns.part_count === null ||
    columns.passenger_count === null
  ) {
    return null;
  }
  return {
    partNumber: columns.part_number,
    partCount: columns.part_count,
    passengerCount: columns.passenger_count,
  };
}
