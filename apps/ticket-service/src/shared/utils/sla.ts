import { TicketPriority } from "@prisma/client";

const businessStartHourUtc = 9;
const businessEndHourUtc = 17;
const businessHoursPerDay = businessEndHourUtc - businessStartHourUtc;

export function calculateSlaDueAt(
  priority: TicketPriority,
  startAt: Date,
): Date {
  if (priority === TicketPriority.critical) {
    return new Date(startAt.getTime() + 60 * 60 * 1000);
  }

  const durationHours: Record<TicketPriority, number> = {
    critical: 1,
    high: 4,
    medium: 3 * businessHoursPerDay,
    low: 5 * businessHoursPerDay,
  };

  let remainingHours = durationHours[priority];
  let cursor = new Date(startAt);

  while (remainingHours > 0) {
    if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(businessStartHourUtc, 0, 0, 0);
      continue;
    }

    if (cursor.getUTCHours() < businessStartHourUtc) {
      cursor.setUTCHours(businessStartHourUtc, 0, 0, 0);
    } else if (cursor.getUTCHours() >= businessEndHourUtc) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(businessStartHourUtc, 0, 0, 0);
      continue;
    }

    const availableHours =
      businessEndHourUtc -
      cursor.getUTCHours() -
      cursor.getUTCMinutes() / 60 -
      cursor.getUTCSeconds() / 3600;
    const hoursToAdd = Math.min(availableHours, remainingHours);
    cursor.setTime(cursor.getTime() + hoursToAdd * 60 * 60 * 1000);
    remainingHours -= hoursToAdd;
  }

  return cursor;
}

export function isSlaOverdue(dueAt: Date | null, now: Date): boolean {
  return dueAt !== null && now.getTime() > dueAt.getTime();
}
