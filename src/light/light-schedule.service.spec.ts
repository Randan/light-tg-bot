import { LightScheduleService } from './light-schedule.service';
import type { ScheduleDay } from './schedule-format.util';
import type { YasnoGroupSchedule } from './yasno.service';

const notPlannedAllDay = [{ start: 0, end: 1440, type: 'NotPlanned' }];

describe('LightScheduleService.poll', () => {
  let stored: (ScheduleDay & { fetchedAt: Date })[];
  let response: YasnoGroupSchedule;
  let lookup: jest.Mock;
  let notifySubscribers: jest.Mock;
  let adminMessages: string[];
  let service: LightScheduleService;

  beforeEach(() => {
    stored = [];
    adminMessages = [];
    notifySubscribers = jest.fn();
    lookup = jest.fn().mockResolvedValue('2.1');
    response = {
      group: '2.1',
      today: { date: '2026-10-18', status: 'ScheduleApplies', slots: [{ start: 810, end: 1020, type: 'Definite' }] },
      tomorrow: { date: '2026-10-19', status: 'WaitingForSchedule', slots: [] },
    };

    // the subset of the mongoose model the service uses, backed by an array
    const latest = (filter: { date?: string }) =>
      stored.filter(doc => !filter.date || doc.date === filter.date).sort((a, b) => +b.fetchedAt - +a.fetchedAt)[0] ??
      null;
    const query = (filter: { date?: string }) => {
      const chain = {
        sort: () => chain,
        select: () => chain,
        lean: () => chain,
        exec: async () => latest(filter),
      };
      return chain;
    };
    const scheduleModel = {
      findOne: (filter = {}) => query(filter),
      create: async (doc: ScheduleDay & { fetchedAt: Date }) => {
        stored.push({ ...doc, fetchedAt: new Date(Date.now() + stored.length) });
      },
    };

    const config = { get: (key: string, fallback?: unknown) => ({ TUYA_DEVICE_ID: 'dev' })[key] ?? fallback };
    const yasno = {
      isConfigured: () => true,
      resolveGroupByAddress: lookup,
      getGroupSchedule: jest.fn(async () => response),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    service = new LightScheduleService(
      config as never,
      yasno as never,
      scheduleModel as never,
      { notifySubscribers } as never,
      logger as never,
      { send: (message: string) => adminMessages.push(message) } as never,
    );
  });

  it('stores the first version of each day silently', async () => {
    await service.poll();
    expect(stored).toHaveLength(2);
    expect(notifySubscribers).not.toHaveBeenCalled();
  });

  it('does not treat [] and an all-day NotPlanned slot as a change (the 18.10 "published: not published")', async () => {
    await service.poll();
    response.tomorrow = { ...response.tomorrow, slots: notPlannedAllDay };
    await service.poll();

    expect(stored).toHaveLength(2);
    expect(notifySubscribers).not.toHaveBeenCalled();
  });

  it('announces tomorrow once it is published', async () => {
    await service.poll();
    response.tomorrow = {
      date: '2026-10-19',
      status: 'ScheduleApplies',
      slots: [{ start: 480, end: 690, type: 'Definite' }],
    };
    await service.poll();

    expect(notifySubscribers).toHaveBeenCalledTimes(1);
    expect(notifySubscribers.mock.calls[0][1]).toContain('📅 Опубліковано графік на завтра (19.10)');
  });

  it('keeps going on the stored group when the address stops resolving, and tells the admin once', async () => {
    await service.poll();
    lookup.mockRejectedValue(new Error('House 40503 not found'));

    await service.poll();
    await service.poll();

    expect(service.getGroupInfo()).toEqual({ group: '2.1', source: 'stored', error: 'House 40503 not found' });
    expect(service.isFresh()).toBe(true);
    expect(adminMessages).toHaveLength(1);
    expect(adminMessages[0]).toContain('беру останню збережену (2.1)');

    lookup.mockResolvedValue('2.1');
    await service.poll();
    expect(adminMessages).toEqual([adminMessages[0], '✅ Групу знову визначено за адресою']);
  });
});

describe('LightScheduleService', () => {
  const NOW = new Date('2026-10-20T09:00:00Z'); // 12:00 in Kyiv
  let days: Record<string, ScheduleDay>;
  let env: Record<string, string>;
  let yasno: Record<string, jest.Mock>;
  let adminMessages: string[];
  let service: LightScheduleService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    days = {};
    env = { TUYA_DEVICE_ID: 'dev', TIMEZONE: 'Europe/Kyiv' };
    adminMessages = [];
    yasno = {
      isConfigured: jest.fn().mockReturnValue(true),
      resolveGroupByAddress: jest.fn().mockResolvedValue('2.1'),
      // YASNO answers with whatever the test put in `days`, so a poll keeps them
      getGroupSchedule: jest.fn(async () => ({
        group: '2.1',
        today: days['2026-10-20'] ?? { date: '2026-10-20', status: 'ScheduleApplies', slots: [] },
        tomorrow: days['2026-10-21'] ?? { date: '2026-10-21', status: 'WaitingForSchedule', slots: [] },
      })),
    };
    const chain = (value: unknown) => ({
      sort: () => chain(value),
      select: () => chain(value),
      lean: () => chain(value),
      exec: async () => value,
    });
    const scheduleModel = {
      findOne: (filter: { date?: string } = {}) =>
        chain(filter.date ? (days[filter.date] ?? null) : (Object.values(days)[0] ?? null)),
      create: async (doc: ScheduleDay) => (days[doc.date] = doc),
    };
    service = new LightScheduleService(
      { get: (key: string, fallback?: unknown) => env[key] ?? fallback } as never,
      yasno as never,
      scheduleModel as never,
      { notifySubscribers: jest.fn() } as never,
      { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { send: (message: string) => adminMessages.push(message) } as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  const applies = (date: string, ranges: [number, number][]): ScheduleDay => ({
    date,
    group: '2.1',
    status: 'ScheduleApplies',
    slots: ranges.map(([s, e]) => ({ start: s * 60, end: e * 60, type: 'Definite' })),
  });

  describe('describeNextChange', () => {
    /** Moves the clock and polls, so the stored schedule is fresh at that time. */
    const at = async (iso: string) => {
      jest.setSystemTime(new Date(iso));
      await service.poll();
    };

    beforeEach(async () => {
      days['2026-10-20'] = applies('2026-10-20', [
        [8, 11.5],
        [17, 20.5],
      ]);
      await service.poll();
    });

    it('tells when the power goes off next while it is on', async () => {
      await expect(service.describeNextChange(true)).resolves.toBe('За графіком вимкнуть о 17:00 (через 5 годин)');
    });

    it('tells when the power is back while it is off during a scheduled outage', async () => {
      await at('2026-10-20T15:00:00Z'); // 18:00 Kyiv
      await expect(service.describeNextChange(false)).resolves.toBe(
        'За графіком мають увімкнути о 20:30 (через 2 години 30 хвилин)',
      );
    });

    it('says "tomorrow" for an outage on the next day', async () => {
      days['2026-10-21'] = applies('2026-10-21', [[6, 9.5]]);
      await at('2026-10-20T18:00:00Z'); // 21:00 Kyiv
      await expect(service.describeNextChange(true)).resolves.toBe(
        'За графіком вимкнуть завтра о 06:00 (через 9 годин)',
      );
    });

    it('is null when the schedule says nothing', async () => {
      await expect(service.describeNextChange(false)).resolves.toBeNull(); // 12:00, no outage now
    });

    it('mentions emergency outages', async () => {
      days['2026-10-20'] = { ...days['2026-10-20'], status: 'EmergencyShutdowns' };
      await expect(service.describeNextChange(true)).resolves.toBe('🚨 Діють екстрені відключення, графік не діє');
    });

    it('stays silent when the stored schedule may be out of date', async () => {
      jest.setSystemTime(new Date(NOW.getTime() + 31 * 60 * 1000));
      expect(service.isFresh()).toBe(false);
      await expect(service.describeNextChange(true)).resolves.toBeNull();
    });
  });

  it('is disabled without an address or a group', () => {
    yasno.isConfigured.mockReturnValue(false);
    service.onModuleInit();
    service.onApplicationBootstrap();
    expect(yasno.getGroupSchedule).not.toHaveBeenCalled();
  });

  it('polls on its interval once configured, and stops on shutdown', async () => {
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(yasno.getGroupSchedule).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(yasno.getGroupSchedule).toHaveBeenCalledTimes(1);
  });

  it('uses YASNO_GROUP without looking the address up', async () => {
    env.YASNO_GROUP = '19.1';
    await service.poll();
    expect(yasno.resolveGroupByAddress).not.toHaveBeenCalled();
    expect(yasno.getGroupSchedule).toHaveBeenCalledWith('19.1');
    expect(service.getGroupInfo()).toEqual({ group: '19.1', source: 'env', error: null });
  });

  it('fails the poll when the address does not resolve and nothing is stored yet', async () => {
    yasno.resolveGroupByAddress.mockRejectedValue(new Error('House not found'));
    await service.poll();
    expect(service.getLastPoll()?.error).toBe('House not found');
    expect(service.getLastFailure()?.message).toBe('House not found');
    expect(service.isFresh()).toBe(false);
    expect(adminMessages[0]).toBe('🚨 YASNO schedule poll failed: House not found');
  });

  it('alerts once about failing polls and once about the recovery', async () => {
    yasno.getGroupSchedule
      .mockRejectedValueOnce(new Error('responded 503'))
      .mockRejectedValueOnce(new Error('responded 503'));
    await service.poll();
    await service.poll();
    await service.poll();
    expect(adminMessages).toEqual(['🚨 YASNO schedule poll failed: responded 503', '✅ YASNO знову віддає графік']);
    expect(service.getLastSuccessAt()).toEqual(NOW);
  });

  it('gives today and tomorrow by Kyiv date', async () => {
    jest.setSystemTime(new Date('2026-10-20T21:30:00Z')); // already 21.10 in Kyiv
    days['2026-10-21'] = applies('2026-10-21', [[6, 9]]);
    const { today, tomorrow } = await service.getCurrent();
    expect(today?.date).toBe('2026-10-21');
    expect(tomorrow).toBeNull();
  });
});
