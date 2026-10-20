import { computeOffDuration, LightStatisticsService } from './light-statistics.service';

const at = (iso: string) => new Date(iso);
const HOUR = 60 * 60 * 1000;

describe('computeOffDuration', () => {
  const start = at('2026-10-20T00:00:00Z');
  const end = at('2026-10-20T12:00:00Z');

  it('sums the closed outages inside the period', () => {
    const entries = [
      { timestamp: at('2026-10-20T02:00:00Z'), status: false },
      { timestamp: at('2026-10-20T04:00:00Z'), status: true },
      { timestamp: at('2026-10-20T06:00:00Z'), status: false },
      { timestamp: at('2026-10-20T06:30:00Z'), status: true },
    ];
    expect(computeOffDuration(start, end, { timestamp: at('2026-10-19T20:00:00Z'), status: true }, entries)).toBe(
      2.5 * HOUR,
    );
  });

  it('counts an outage that began before the period from the period start', () => {
    const entries = [{ timestamp: at('2026-10-20T01:00:00Z'), status: true }];
    expect(computeOffDuration(start, end, { timestamp: at('2026-10-19T22:00:00Z'), status: false }, entries)).toBe(
      HOUR,
    );
  });

  it('counts an outage still going on up to the period end', () => {
    const entries = [{ timestamp: at('2026-10-20T10:00:00Z'), status: false }];
    expect(computeOffDuration(start, end, null, entries)).toBe(2 * HOUR);
  });

  it('ignores a repeated "off" entry', () => {
    const entries = [
      { timestamp: at('2026-10-20T10:00:00Z'), status: false },
      { timestamp: at('2026-10-20T11:00:00Z'), status: false },
    ];
    expect(computeOffDuration(start, end, null, entries)).toBe(2 * HOUR);
  });
});

type Entry = { timestamp: Date; status: boolean };
type Range = { $gte?: Date; $lt?: Date; $lte?: Date };

/** The subset of the mongoose model the statistics use, over an array. */
function historyModel(entries: Entry[]) {
  const matches = (entry: Entry, filter: { timestamp?: Range; status?: boolean }) => {
    const t = entry.timestamp.getTime();
    const r = filter.timestamp ?? {};
    return (
      (r.$gte === undefined || t >= r.$gte.getTime()) &&
      (r.$lt === undefined || t < r.$lt.getTime()) &&
      (r.$lte === undefined || t <= r.$lte.getTime()) &&
      (filter.status === undefined || entry.status === filter.status)
    );
  };
  const sorted = (filter: object, dir: number) =>
    entries.filter(e => matches(e, filter)).sort((a, b) => dir * (a.timestamp.getTime() - b.timestamp.getTime()));
  const chain = (result: (dir: number) => unknown) => ({
    sort: (spec: { timestamp: number }) => ({ lean: () => ({ exec: async () => result(spec.timestamp) }) }),
  });
  return {
    findOne: (filter = {}) => chain(dir => sorted(filter, dir)[0] ?? null),
    find: (filter = {}) => chain(dir => sorted(filter, dir)),
    countDocuments: async (filter = {}) => entries.filter(e => matches(e, filter)).length,
  };
}

describe('LightStatisticsService.getStatisticsMessage', () => {
  // Tuesday 20.10.2026, 12:00 in Kyiv
  beforeEach(() => jest.useFakeTimers().setSystemTime(at('2026-10-20T09:00:00Z')));
  afterEach(() => jest.useRealTimers());

  const service = (entries: Entry[]) =>
    new LightStatisticsService(
      historyModel(entries) as never,
      { get: () => 'Europe/Kyiv' } as never,
      { log: jest.fn() } as never,
    );

  const history: Entry[] = [
    { timestamp: at('2026-08-31T21:00:00Z'), status: true }, // 01.09 00:00 Kyiv
    { timestamp: at('2026-10-18T13:13:33Z'), status: false }, // Sunday, last week
    { timestamp: at('2026-10-18T15:13:33Z'), status: true },
    { timestamp: at('2026-10-20T05:00:00Z'), status: false }, // today 08:00–10:30 Kyiv
    { timestamp: at('2026-10-20T07:30:00Z'), status: true },
  ];

  it('splits today and this week at Kyiv midnight, not UTC', async () => {
    const message = await service(history).getStatisticsMessage();
    expect(message).toContain('*за сьогодні:*\nкількість - 1\nтривалість - 2 години 30 хвилин\n🟢79% 🔴21%');
    expect(message).toContain('*цей тиждень (2 дні):*\nкількість - 1');
    expect(message).toContain('*минулий тиждень:*\nкількість - 1\nтривалість - 2 години');
  });

  it('shows the current month and year once a week has passed, and hides periods before the first entry', async () => {
    const message = await service(history).getStatisticsMessage();
    expect(message).toContain('*цей місяць (20 днів):*\nкількість - 2');
    expect(message).toContain('*минулий місяць:*\nкількість - 0');
    expect(message).toContain('*цей рік (293 дні):*');
    expect(message).not.toContain('минулий рік');
    expect(message).toContain('*за весь час:*\nкількість - 2\nтривалість - 4 години 30 хвилин');
  });

  it('counts an outage going on right now', async () => {
    const ongoing = [...history.slice(0, 3), { timestamp: at('2026-10-20T07:00:00Z'), status: false }];
    const message = await service(ongoing).getStatisticsMessage();
    expect(message).toContain('*за сьогодні:*\nкількість - 1\nтривалість - 2 години\n');
  });

  it('works without any history', async () => {
    const message = await service([]).getStatisticsMessage();
    expect(message).toContain('*за сьогодні:*\nкількість - 0\nтривалість - менше хвилини\n🟢100% 🔴0%');
  });
});
