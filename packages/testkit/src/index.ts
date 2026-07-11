export interface Clock {
  now(): Date;
}

export class FixedClock implements Clock {
  constructor(private readonly value: Date) {}

  now(): Date {
    return new Date(this.value.getTime());
  }
}

export const SYNTHETIC_EVENT_ID = "demo-2026";
export const SYNTHETIC_DEVICE_ID = "technical-scaffold";
