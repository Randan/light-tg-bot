import { LightCronService } from './light-cron.service';

jest.mock('./network.util', () => ({ isNetworkAvailable: jest.fn().mockResolvedValue(true) }));

describe('LightCronService.pollDeviceStatus', () => {
  let readings: (boolean | null)[];
  let history: { timestamp: Date; status: boolean } | null;
  let applyStatusChange: jest.Mock;
  let cron: LightCronService;

  beforeEach(() => {
    readings = [];
    history = { timestamp: new Date('2026-10-18T10:00:00Z'), status: true };
    applyStatusChange = jest.fn(async (_deviceId: string, status: boolean, changedAt: Date) => {
      history = { timestamp: changedAt, status };
    });

    const config = { get: (key: string, fallback?: unknown) => ({ TUYA_DEVICE_ID: 'dev' })[key] ?? fallback };
    const tuya = { isDeviceOnline: jest.fn(async () => readings.shift() ?? null) };
    const status = { getLastHistoryEntry: jest.fn(async () => history), applyStatusChange };
    const schedule = { describeNextChange: jest.fn(async () => null) };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const notifyAdmin = { send: jest.fn() };

    cron = new LightCronService(
      config as never,
      tuya as never,
      status as never,
      schedule as never,
      logger as never,
      notifyAdmin as never,
    );
  });

  it('records a change only after two equal readings, dated by the first', async () => {
    readings = [false, false];

    expect(await cron.pollDeviceStatus()).toBe('pending');
    const firstSeen = cron.getLastCheck()!.checkedAt;
    expect(applyStatusChange).not.toHaveBeenCalled();

    expect(await cron.pollDeviceStatus()).toBe('changed');
    expect(applyStatusChange).toHaveBeenCalledTimes(1);
    expect(applyStatusChange.mock.calls[0][1]).toBe(false);
    expect(applyStatusChange.mock.calls[0][2]).toBe(firstSeen);
  });

  it('ignores a one-reading blip', async () => {
    readings = [false, true, true];

    expect(await cron.pollDeviceStatus()).toBe('pending');
    expect(await cron.pollDeviceStatus()).toBe('unchanged');
    expect(await cron.pollDeviceStatus()).toBe('unchanged');
    expect(applyStatusChange).not.toHaveBeenCalled();
  });

  it('never turns a failed Tuya call into "power off"', async () => {
    readings = [null, null];

    expect(await cron.pollDeviceStatus()).toBe('unknown');
    expect(await cron.pollDeviceStatus()).toBe('unknown');
    expect(applyStatusChange).not.toHaveBeenCalled();
  });

  it('records the very first status without waiting for a confirmation', async () => {
    history = null;
    readings = [true];

    expect(await cron.pollDeviceStatus()).toBe('changed');
    expect(applyStatusChange).toHaveBeenCalledTimes(1);
  });
});

describe('LightCronService loop', () => {
  const build = (overrides: { isOnline?: jest.Mock; history?: jest.Mock } = {}) => {
    const adminMessages: string[] = [];
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const cron = new LightCronService(
      { get: (key: string, fallback?: unknown) => ({ TUYA_DEVICE_ID: 'dev' })[key] ?? fallback } as never,
      { isDeviceOnline: overrides.isOnline ?? jest.fn().mockResolvedValue(true) } as never,
      {
        getLastHistoryEntry: overrides.history ?? jest.fn().mockResolvedValue({ timestamp: new Date(), status: true }),
        applyStatusChange: jest.fn(),
      } as never,
      { describeNextChange: jest.fn().mockResolvedValue(null) } as never,
      logger as never,
      { send: (message: string) => adminMessages.push(message) } as never,
    );
    return { cron, adminMessages, logger };
  };

  afterEach(() => jest.useRealTimers());

  it('skips a poll while the previous one is still running', async () => {
    let release!: (value: boolean) => void;
    const isOnline = jest.fn(() => new Promise<boolean>(resolve => (release = resolve)));
    const { cron } = build({ isOnline });

    const first = cron.pollDeviceStatus();
    await new Promise(setImmediate);
    await expect(cron.pollDeviceStatus()).resolves.toBe('busy');
    release(true);
    await expect(first).resolves.toBe('unchanged');
  });

  it('skips the check without network', async () => {
    const network = jest.requireMock('./network.util') as { isNetworkAvailable: jest.Mock };
    network.isNetworkAvailable.mockResolvedValueOnce(false);
    const isOnline = jest.fn();
    const { cron } = build({ isOnline });
    await expect(cron.pollDeviceStatus()).resolves.toBe('no-network');
    expect(isOnline).not.toHaveBeenCalled();
  });

  it('alerts once about a failing round and once about the recovery', async () => {
    const history = jest.fn().mockRejectedValue(new Error('db down'));
    const { cron, adminMessages } = build({ history });

    await expect(cron.pollDeviceStatus()).resolves.toBe('failed');
    await expect(cron.pollDeviceStatus()).resolves.toBe('failed');
    history.mockResolvedValue({ timestamp: new Date(), status: true });
    await expect(cron.pollDeviceStatus()).resolves.toBe('unchanged');

    expect(adminMessages).toEqual(['🚨 Light cron error: db down', '✅ Перевірка світла знову працює']);
  });

  it('counts as stuck after three intervals without a finished round', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-20T09:00:00Z'));
    const { cron } = build();
    expect(cron.isPolling()).toBe(true);
    await cron.pollDeviceStatus();
    jest.setSystemTime(new Date('2026-10-20T09:09:00Z'));
    expect(cron.isPolling()).toBe(true);
    jest.setSystemTime(new Date('2026-10-20T09:09:01Z'));
    expect(cron.isPolling()).toBe(false);
  });

  it('polls on its interval and stops on shutdown', async () => {
    jest.useFakeTimers();
    const isOnline = jest.fn().mockResolvedValue(true);
    const { cron } = build({ isOnline });
    cron.onModuleInit();
    await jest.advanceTimersByTimeAsync(3 * 60 * 1000);
    expect(isOnline).toHaveBeenCalledTimes(1);
    cron.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(isOnline).toHaveBeenCalledTimes(1);
  });

  it('restarts the process when the polling is stuck, after telling the admin', async () => {
    jest.useFakeTimers();
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const isOnline = jest.fn(() => new Promise<boolean>(() => undefined)); // never answers
    const { cron, adminMessages } = build({ isOnline });
    cron.onModuleInit();

    // stuck after 3 intervals (9 min); the next watchdog tick at 10 min alerts
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(adminMessages).toHaveLength(1);
    expect(adminMessages[0]).toContain('Перевірка світла зависла');
    expect(exit).not.toHaveBeenCalled(); // the alert gets time to leave first

    await jest.advanceTimersByTimeAsync(5000);
    expect(exit).toHaveBeenCalledWith(1);

    cron.onModuleDestroy();
    exit.mockRestore();
  });
});
