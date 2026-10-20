import { getForm } from './format-time.util';
import type { OutageSlot } from './schemas/outage-schedule.schema';

export const ScheduleStatus = {
  Applies: 'ScheduleApplies',
  NoOutages: 'NoOutages',
  Waiting: 'WaitingForSchedule',
  Emergency: 'EmergencyShutdowns',
} as const;

const MINUTES_PER_DAY = 24 * 60;

/** DTEK may cut the power a few minutes before the scheduled start. */
const EARLY_CUT_TOLERANCE_MINUTES = 15;

export interface ScheduleDay {
  date: string;
  group: string;
  status: string;
  slots: OutageSlot[];
  updatedOn?: Date;
}

export interface OutageRange {
  start: number;
  end: number;
}

/** Date and minutes since midnight in the given time zone. */
export function zonedNow(timeZone: string, now = new Date()): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map(part => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** The calendar day in the given time zone; weekday 0 is Monday. */
export function zonedCalendar(
  timeZone: string,
  now = new Date(),
): { year: number; month: number; day: number; weekday: number } {
  const [year, month, day] = zonedNow(timeZone, now).date.split('-').map(Number);
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return { year, month, day, weekday };
}

/** How far the zone's wall clock is ahead of UTC at the given moment. */
function zoneOffsetMs(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map(part => [part.type, Number(part.value)]),
  );
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wallClock - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The moment the given day starts in the time zone. Out-of-range values roll
 * over like Date.UTC: day 0 is the last day of the previous month.
 */
export function zonedMidnight(timeZone: string, year: number, month: number, day: number): Date {
  const wallClock = Date.UTC(year, month - 1, day);
  const guess = wallClock - zoneOffsetMs(timeZone, new Date(wallClock));
  // recheck at the guess: the offset differs across a DST switch
  return new Date(wallClock - zoneOffsetMs(timeZone, new Date(guess)));
}

export function zonedTomorrow(timeZone: string, now = new Date()): string {
  return zonedNow(timeZone, new Date(now.getTime() + MINUTES_PER_DAY * 60 * 1000)).date;
}

/** Planned outage intervals of a day, adjacent slots merged. */
export function outageRanges(slots: OutageSlot[]): OutageRange[] {
  const ranges: OutageRange[] = [];
  slots
    .filter(slot => slot.type !== 'NotPlanned')
    .sort((a, b) => a.start - b.start)
    .forEach(slot => {
      const last = ranges[ranges.length - 1];
      if (last && slot.start <= last.end) {
        last.end = Math.max(last.end, slot.end);
        return;
      }
      ranges.push({ start: slot.start, end: slot.end });
    });
  return ranges;
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "1 годину 20 хвилин" — the accusative form that follows "через". */
export function formatDurationAfter(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} ${getForm(hours, 'годину', 'години', 'годин')}`);
  }
  if (minutes > 0 || hours === 0) {
    parts.push(`${minutes} ${getForm(minutes, 'хвилину', 'хвилини', 'хвилин')}`);
  }
  return parts.join(' ');
}

/** "15.10" from "2026-10-15". */
export function formatDate(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}.${month}`;
}

export function describeDay(day: Pick<ScheduleDay, 'status' | 'slots'>): string {
  const ranges = outageRanges(day.slots).map(r => `🔴 ${formatMinutes(r.start)}–${formatMinutes(r.end)}`);

  switch (day.status) {
    case ScheduleStatus.Applies:
      return ranges.length ? `Графік діє:\n${ranges.join('\n')}` : 'Графік діє, відключень не заплановано ✅';
    case ScheduleStatus.NoOutages:
      return 'Відключень не заплановано ✅';
    case ScheduleStatus.Waiting:
      return '⏳ Графік ще не опубліковано';
    case ScheduleStatus.Emergency:
      return '🚨 Екстрені відключення, графік не діє';
    default:
      return [`❔ Невідомий статус графіка: ${day.status}`, ...ranges].join('\n');
  }
}

export function describeChange(dayTitle: string, day: ScheduleDay, previous: ScheduleDay): string {
  const lines: string[] = [];
  const lifted = previous.status === ScheduleStatus.Emergency && day.status !== ScheduleStatus.Emergency;

  if (day.status === ScheduleStatus.Emergency) {
    lines.push(`🚨 Введено екстрені відключення — графік на ${dayTitle} не діє`);
  } else if (day.status === ScheduleStatus.Waiting) {
    // no schedule to show: say so instead of "published: not published"
    const waiting = `⏳ Графік на ${dayTitle} ще не опубліковано`;
    lines.push(lifted ? `✅ Екстрені відключення скасовано. ${waiting}` : waiting);
  } else {
    if (lifted) {
      lines.push(`✅ Екстрені відключення скасовано. Графік на ${dayTitle}:`);
    } else if (previous.status === ScheduleStatus.Waiting) {
      lines.push(`📅 Опубліковано графік на ${dayTitle}:`);
    } else {
      lines.push(`📅 Графік на ${dayTitle} змінився:`);
    }
    lines.push(describeDay(day));
  }

  if (day.group !== previous.group) {
    lines.push(`\nГрупа будинку змінилася: ${previous.group} → ${day.group}`);
  }
  return lines.join('\n');
}

/**
 * When the schedule says the power comes back, in minutes since today's
 * midnight (past a day when the outage runs over midnight); null when the
 * schedule has no outage going on right now.
 */
export function scheduledTurnOn(
  today: ScheduleDay | null,
  tomorrow: ScheduleDay | null,
  nowMinutes: number,
): number | null {
  if (today?.status !== ScheduleStatus.Applies) {
    return null;
  }
  const current = outageRanges(today.slots).find(
    r => r.start - EARLY_CUT_TOLERANCE_MINUTES <= nowMinutes && nowMinutes < r.end,
  );
  if (!current) {
    return null;
  }
  if (current.end >= MINUTES_PER_DAY && tomorrow?.status === ScheduleStatus.Applies) {
    const continuation = outageRanges(tomorrow.slots).find(r => r.start === 0);
    if (continuation) {
      return MINUTES_PER_DAY + continuation.end;
    }
  }
  return current.end;
}

/**
 * When the next scheduled outage starts, in minutes since today's midnight
 * (past a day when it is tomorrow); null when none is scheduled.
 */
export function scheduledTurnOff(
  today: ScheduleDay | null,
  tomorrow: ScheduleDay | null,
  nowMinutes: number,
): number | null {
  if (today?.status === ScheduleStatus.Applies) {
    const next = outageRanges(today.slots).find(r => r.start > nowMinutes);
    if (next) {
      return next.start;
    }
  }
  if (tomorrow?.status === ScheduleStatus.Applies) {
    // an outage running on from today's last slot is not a new turn-off
    const runsPastMidnight = today ? outageRanges(today.slots).some(r => r.end >= MINUTES_PER_DAY) : false;
    const next = outageRanges(tomorrow.slots).find(r => !(r.start === 0 && runsPastMidnight));
    if (next) {
      return MINUTES_PER_DAY + next.start;
    }
  }
  return null;
}
