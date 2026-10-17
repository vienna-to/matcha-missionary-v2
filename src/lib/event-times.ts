/** Shown wherever an event's start and end time are entered or submitted. */
export const END_BEFORE_START_MESSAGE = "End time must be after the start time.";

/**
 * Events are single-day (one date, a start and an end time), so the end has to
 * be later than the start. Returns a message when it is not, otherwise null.
 * Empty values are not judged here (the forms already require both).
 */
export function validateEventTimes(start: string | undefined, end: string | undefined): string | null {
  if (!start || !end) return null;
  // "HH:MM" compares correctly as a string.
  return end > start ? null : END_BEFORE_START_MESSAGE;
}
