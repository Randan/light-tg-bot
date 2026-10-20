import type { ScheduleDay } from './schedule-format.util';
import {
  describeChange,
  formatDurationAfter,
  outageRanges,
  scheduledTurnOff,
  scheduledTurnOn,
  ScheduleStatus,
  zonedMidnight,
  zonedNow,
} from './schedule-format.util';

const h = (hours: number) => hours * 60;

function day(date: string, status: string, ranges: [number, number][], group = '2.1'): ScheduleDay {
  return {
    date,
    group,
    status,
    slots: ranges.map(([start, end]) => ({ start: h(start), end: h(end), type: 'Definite' })),
  };
}

const applies = (date: string, ranges: [number, number][]) => day(date, ScheduleStatus.Applies, ranges);

describe('outageRanges', () => {
  it('drops NotPlanned slots and merges adjacent ones', () => {
    const slots = [
      { start: 0, end: h(8), type: 'NotPlanned' },
      { start: h(8), end: h(10), type: 'Definite' },
      { start: h(10), end: h(11.5), type: 'Definite' },
      { start: h(17), end: h(20.5), type: 'Definite' },
    ];
    expect(outageRanges(slots)).toEqual([
      { start: h(8), end: h(11.5) },
      { start: h(17), end: h(20.5) },
    ]);
  });
});

describe('scheduledTurnOn', () => {
  const today = applies('2026-10-15', [[15, 18.5]]);

  it('is the end of the outage going on now', () => {
    expect(scheduledTurnOn(today, null, h(16))).toBe(h(18.5));
  });

  it('matches a cut up to 15 minutes before the scheduled start', () => {
    expect(scheduledTurnOn(today, null, h(14) + 50)).toBe(h(18.5));
    expect(scheduledTurnOn(today, null, h(14) + 44)).toBeNull();
  });

  it('is null outside the schedule: an accident, not a planned outage', () => {
    expect(scheduledTurnOn(today, null, h(19))).toBeNull();
  });

  it('follows an outage over midnight into tomorrow', () => {
    const late = applies('2026-10-15', [[22, 24]]);
    const early = applies('2026-10-16', [
      [0, 1.5],
      [12, 14],
    ]);
    expect(scheduledTurnOn(late, early, h(23))).toBe(h(24) + h(1.5));
  });

  it('is null without a schedule that applies', () => {
    expect(scheduledTurnOn(null, null, h(16))).toBeNull();
    expect(scheduledTurnOn(day('2026-10-15', ScheduleStatus.Emergency, []), null, h(16))).toBeNull();
  });
});

describe('scheduledTurnOff', () => {
  const today = applies('2026-10-15', [[15, 18.5]]);
  const waiting = day('2026-10-16', ScheduleStatus.Waiting, []);

  it('is the next outage today', () => {
    expect(scheduledTurnOff(today, waiting, h(14))).toBe(h(15));
  });

  it('moves to tomorrow once published', () => {
    expect(scheduledTurnOff(today, waiting, h(19))).toBeNull();
    expect(scheduledTurnOff(today, applies('2026-10-16', [[6, 9.5]]), h(19))).toBe(h(24) + h(6));
  });

  it('does not count the tail of an outage running past midnight as a new one', () => {
    const late = applies('2026-10-15', [[22, 24]]);
    const early = applies('2026-10-16', [
      [0, 1.5],
      [12, 14],
    ]);
    expect(scheduledTurnOff(late, early, h(23))).toBe(h(24) + h(12));
  });

  it('is null when no outages are planned', () => {
    expect(scheduledTurnOff(day('2026-10-15', ScheduleStatus.NoOutages, []), null, h(10))).toBeNull();
  });
});

describe('describeChange', () => {
  const waiting = day('2026-10-19', ScheduleStatus.Waiting, []);

  it('announces a published schedule', () => {
    const published = applies('2026-10-19', [[8, 11.5]]);
    expect(describeChange('завтра (19.10)', published, waiting)).toBe(
      '📅 Опубліковано графік на завтра (19.10):\nГрафік діє:\n🔴 08:00–11:30',
    );
  });

  it('never says "published" about a schedule that is not published', () => {
    const message = describeChange('завтра (19.10)', waiting, applies('2026-10-19', [[8, 11.5]]));
    expect(message).toBe('⏳ Графік на завтра (19.10) ще не опубліковано');
    expect(message).not.toContain('Опубліковано');
  });

  it('reports emergency outages and their end', () => {
    const emergency = day('2026-10-17', ScheduleStatus.Emergency, []);
    const normal = applies('2026-10-17', [[19, 22.5]]);
    expect(describeChange('сьогодні (17.10)', emergency, normal)).toBe(
      '🚨 Введено екстрені відключення — графік на сьогодні (17.10) не діє',
    );
    expect(describeChange('сьогодні (17.10)', normal, emergency)).toBe(
      '✅ Екстрені відключення скасовано. Графік на сьогодні (17.10):\nГрафік діє:\n🔴 19:00–22:30',
    );
    expect(describeChange('завтра (18.10)', waiting, emergency)).toBe(
      '✅ Екстрені відключення скасовано. ⏳ Графік на завтра (18.10) ще не опубліковано',
    );
  });

  it('mentions a group change', () => {
    const moved = day('2026-10-15', ScheduleStatus.Applies, [[22, 24]], '20.1');
    expect(describeChange('сьогодні (15.10)', moved, applies('2026-10-15', [[10, 13.5]]))).toContain(
      'Група будинку змінилася: 2.1 → 20.1',
    );
  });
});

describe('formatDurationAfter', () => {
  it('uses the accusative after "через"', () => {
    expect([1, 21, 60, 61, 125, 300].map(formatDurationAfter)).toEqual([
      '1 хвилину',
      '21 хвилину',
      '1 годину',
      '1 годину 1 хвилину',
      '2 години 5 хвилин',
      '5 годин',
    ]);
  });
});

describe('time zone helpers', () => {
  const tz = 'Europe/Kyiv';

  it('gives the Kyiv date and minutes', () => {
    expect(zonedNow(tz, new Date('2026-10-15T21:30:00Z'))).toEqual({ date: '2026-10-16', minutes: h(0.5) });
  });

  it('finds midnight on both sides of the switch to winter time (25.10.2026)', () => {
    expect(zonedMidnight(tz, 2026, 10, 25).toISOString()).toBe('2026-10-24T21:00:00.000Z');
    expect(zonedMidnight(tz, 2026, 10, 26).toISOString()).toBe('2026-10-25T22:00:00.000Z');
  });

  it('rolls day 0 over to the previous month', () => {
    expect(zonedMidnight(tz, 2026, 11, 0).toISOString()).toBe('2026-10-30T22:00:00.000Z');
  });
});
