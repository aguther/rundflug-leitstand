export function dispatchSegmentOrderSql(rotationAlias: string, flightGroupAlias: string): string {
  return `COALESCE(${flightGroupAlias}.queue_position, ${rotationAlias}.booking_segment_order, 2147483647)`;
}
