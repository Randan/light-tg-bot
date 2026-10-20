import { AdminService } from '@randan/tg-bot-kit';

import { BOT_COMMANDS } from './bot-commands';
import { LightHandler } from './light.handler';

const ADMIN = 100;
const NOW = new Date('2026-10-20T09:00:00Z'); // 12:00 in Kyiv

describe('LightHandler', () => {
  let env: Record<string, string>;
  let lightStatus: Record<string, jest.Mock>;
  let cron: Record<string, jest.Mock>;
  let statistics: Record<string, jest.Mock>;
  let tuya: Record<string, jest.Mock>;
  let schedule: Record<string, jest.Mock>;
  let adminMessages: string[];
  let handler: LightHandler;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    env = { TUYA_DEVICE_ID: 'dev', ADMIN_TELEGRAM_ID: String(ADMIN), TIMEZONE: 'Europe/Kyiv' };
    lightStatus = {
      subscribe: jest.fn().mockResolvedValue(true),
      unsubscribe: jest.fn().mockResolvedValue(true),
      getLastHistoryEntry: jest.fn().mockResolvedValue({ timestamp: new Date('2026-10-20T07:30:00Z'), status: true }),
      countSubscribers: jest.fn().mockResolvedValue(2),
    };
    cron = {
      getLastCheck: jest.fn().mockReturnValue({ status: true, checkedAt: new Date(NOW.getTime() - 60_000) }),
      getPollIntervalMinutes: jest.fn().mockReturnValue(3),
      pollDeviceStatus: jest.fn().mockResolvedValue('unchanged'),
      isPolling: jest.fn().mockReturnValue(true),
      getRuntime: jest.fn().mockReturnValue({ startedAt: NOW, lastRoundAt: NOW, pendingChange: null }),
    };
    statistics = { getStatisticsMessage: jest.fn().mockResolvedValue('*Статистика відключень*') };
    tuya = {
      getLastError: jest.fn().mockReturnValue(null),
      getHealth: jest.fn().mockReturnValue({ lastSuccessAt: NOW, lastFailure: null }),
    };
    schedule = {
      describeNextChange: jest.fn().mockResolvedValue(null),
      isConfigured: jest.fn().mockReturnValue(true),
      getCurrent: jest.fn().mockResolvedValue({ today: null, tomorrow: null }),
      getLastPoll: jest.fn().mockReturnValue(null),
      getLastSuccessAt: jest.fn().mockReturnValue(NOW),
      isFresh: jest.fn().mockReturnValue(true),
      getPollIntervalMinutes: jest.fn().mockReturnValue(10),
      getGroupInfo: jest.fn().mockReturnValue({ group: '2.1', source: 'address', error: null }),
      getLastFailure: jest.fn().mockReturnValue(null),
    };
    adminMessages = [];

    handler = new LightHandler(
      { get: (key: string) => env[key] } as never,
      lightStatus as never,
      cron as never,
      statistics as never,
      tuya as never,
      schedule as never,
      new AdminService({ get: (key: string) => env[key] } as never),
      { log: jest.fn(), error: jest.fn() } as never,
      { send: (message: string) => adminMessages.push(message) } as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  function ctx(fromId = 1, chatId: number | null = 1) {
    const sent: { text: string; extra?: unknown }[] = [];
    return {
      sent,
      chat: chatId === null ? undefined : { id: chatId },
      from: { id: fromId },
      telegram: {
        sendMessage: jest.fn(async (_chatId: number, text: string, extra?: unknown) => sent.push({ text, extra })),
      },
    };
  }

  const text = (c: ReturnType<typeof ctx>) => c.sent.map(s => s.text).join('\n---\n');

  describe('/help', () => {
    it('lists the public commands only', async () => {
      const c = ctx();
      await handler.help(c as never);
      expect(text(c)).toContain('/schedule');
      expect(text(c)).not.toContain('/statusrequest');
      expect(text(c)).not.toContain('/diag');
      expect(c.sent[0].extra).toEqual({ parse_mode: 'Markdown' });
    });

    it('mentions every command of the Telegram menu', async () => {
      const c = ctx();
      await handler.help(c as never);
      BOT_COMMANDS.forEach(({ command }) => expect(text(c)).toContain(`/${command} `));
      expect(text(c)).toContain('/stop - відписатися від сповіщень');
    });

    it('ignores an update without a chat', async () => {
      const c = ctx(1, null);
      await handler.help(c as never);
      expect(c.sent).toHaveLength(0);
    });
  });

  describe('/start and /stop', () => {
    it('subscribes the chat', async () => {
      const c = ctx(1, 42);
      await handler.start(c as never);
      expect(lightStatus.subscribe).toHaveBeenCalledWith('dev', 42);
      expect(text(c)).toContain('🔔 Готово!');
    });

    it('says so when already subscribed', async () => {
      lightStatus.subscribe.mockResolvedValue(false);
      const c = ctx();
      await handler.start(c as never);
      expect(text(c)).toBe('Ви вже підписані на сповіщення 🙂');
    });

    it('unsubscribes, or says it was not subscribed', async () => {
      const c = ctx(1, 42);
      await handler.stop(c as never);
      expect(lightStatus.unsubscribe).toHaveBeenCalledWith('dev', 42);
      expect(text(c)).toContain('🔕 Сповіщення вимкнено');

      lightStatus.unsubscribe.mockResolvedValue(false);
      const again = ctx();
      await handler.stop(again as never);
      expect(text(again)).toBe('Ви й так не підписані');
    });

    it('answers politely when the database fails', async () => {
      lightStatus.subscribe.mockRejectedValue(new Error('db down'));
      lightStatus.unsubscribe.mockRejectedValue(new Error('db down'));
      const c = ctx();
      await handler.start(c as never);
      await handler.stop(c as never);
      expect(c.sent.map(s => s.text)).toEqual([
        'Не вдалося підписатися, спробуй пізніше',
        'Не вдалося відписатися, спробуй пізніше',
      ]);
    });
  });

  describe('/status', () => {
    it('says how long the power has been on, without a schedule line when there is none', async () => {
      const c = ctx();
      await handler.status(c as never);
      expect(text(c)).toBe('🟢 Світло є\n1 година 30 хвилин');
      expect(schedule.describeNextChange).toHaveBeenCalledWith(true);
    });

    it('adds the schedule line when there is one', async () => {
      lightStatus.getLastHistoryEntry.mockResolvedValue({ timestamp: new Date('2026-10-20T08:00:00Z'), status: false });
      schedule.describeNextChange.mockResolvedValue('За графіком мають увімкнути о 17:30 (через 5 годин 30 хвилин)');
      const c = ctx();
      await handler.status(c as never);
      expect(text(c)).toBe('🔴 Світла немає\n1 година\nЗа графіком мають увімкнути о 17:30 (через 5 годин 30 хвилин)');
    });

    it('warns when Tuya has not answered for three intervals', async () => {
      cron.getLastCheck.mockReturnValue({ status: true, checkedAt: new Date(NOW.getTime() - 10 * 60_000) });
      const c = ctx();
      await handler.status(c as never);
      expect(text(c)).toContain('⚠️ Не вдається отримати свіжі дані від Tuya');
    });

    it('says when there is no data yet', async () => {
      lightStatus.getLastHistoryEntry.mockResolvedValue(null);
      const c = ctx();
      await handler.status(c as never);
      expect(text(c)).toBe('Ще немає даних. Спробуй за кілька хвилин.');
    });

    it('tells the user and the admin when it fails', async () => {
      lightStatus.getLastHistoryEntry.mockRejectedValue(new Error('db down'));
      const c = ctx();
      await handler.status(c as never);
      expect(text(c)).toBe('Помилка при перевірці статусу');
      expect(adminMessages[0]).toContain('db down');
    });
  });

  describe('/statusrequest', () => {
    it('is silent for anyone but the admin, and does not spend a Tuya call', async () => {
      const c = ctx(1);
      await handler.statusRequest(c as never);
      expect(c.sent).toHaveLength(0);
      expect(cron.pollDeviceStatus).not.toHaveBeenCalled();
    });

    it.each([
      ['unchanged', '🟢 Розетка онлайн — світло є'],
      ['changed', '🟢 Розетка онлайн — світло є\nСтатус змінився, записано в історію'],
      ['pending', '🟢 Розетка онлайн, але це ще не підтверджено'],
      ['busy', 'Перевірка вже триває, спробуй за хвилину'],
      ['no-network', '⚠️ На сервері немає інтернету'],
      ['failed', '⚠️ Перевірка впала, деталі в логах'],
    ])('reports "%s"', async (outcome, expected) => {
      cron.pollDeviceStatus.mockResolvedValue(outcome);
      const c = ctx(ADMIN);
      await handler.statusRequest(c as never);
      expect(text(c)).toContain(expected);
    });

    it('shows the Tuya error when the answer is unknown', async () => {
      cron.pollDeviceStatus.mockResolvedValue('unknown');
      tuya.getLastError.mockReturnValue('code=500 msg=system error');
      const c = ctx(ADMIN);
      await handler.statusRequest(c as never);
      expect(text(c)).toBe('⚠️ Tuya не відповіла: code=500 msg=system error');
    });

    it('is silent when no admin is configured', async () => {
      delete env.ADMIN_TELEGRAM_ID;
      const c = ctx(ADMIN);
      await handler.statusRequest(c as never);
      expect(c.sent).toHaveLength(0);
    });
  });

  describe('/schedule', () => {
    const today = {
      date: '2026-10-20',
      group: '2.1',
      status: 'ScheduleApplies',
      slots: [{ start: 480, end: 690, type: 'Definite' }],
      updatedOn: new Date('2026-10-19T17:30:02Z'),
    };

    it('says plainly when the address is not configured', async () => {
      schedule.isConfigured.mockReturnValue(false);
      const c = ctx();
      await handler.scheduleCommand(c as never);
      expect(text(c)).toBe('Графік відключень не налаштовано: не вказано адресу.');
    });

    it('says plainly when there is no schedule information', async () => {
      const c = ctx();
      await handler.scheduleCommand(c as never);
      expect(text(c)).toBe('Немає інформації про графік: дані від YASNO ще не отримано.');

      schedule.getLastPoll.mockReturnValue({ at: NOW, error: 'responded 503' });
      const again = ctx();
      await handler.scheduleCommand(again as never);
      expect(text(again)).toBe('Немає інформації про графік: YASNO не відповідає (responded 503).');
    });

    it('shows today and tomorrow with the group and the freshness', async () => {
      schedule.getCurrent.mockResolvedValue({ today, tomorrow: null });
      const c = ctx();
      await handler.scheduleCommand(c as never);
      expect(text(c)).toBe(
        [
          '📅 Графік відключень ДТЕК (група 2.1)',
          '',
          'Сьогодні (20.10):',
          'Графік діє:',
          '🔴 08:00–11:30',
          '',
          'Завтра:',
          'Немає даних',
          '',
          'Оновлено YASNO: 19.10, 20:30',
          'Перевірено: 20.10, 12:00',
        ].join('\n'),
      );
    });

    it('warns that the stored schedule may be out of date', async () => {
      schedule.getCurrent.mockResolvedValue({ today, tomorrow: null });
      schedule.isFresh.mockReturnValue(false);
      const c = ctx();
      await handler.scheduleCommand(c as never);
      expect(text(c)).toContain('⚠️ Не вдається отримати свіжі дані від YASNO, показую останні збережені');
    });

    it('answers politely when it fails', async () => {
      schedule.getCurrent.mockRejectedValue(new Error('db down'));
      const c = ctx();
      await handler.scheduleCommand(c as never);
      expect(text(c)).toBe('Помилка при отриманні графіка');
    });
  });

  it('has no /diag of its own: the kit renders it from the registered sections', () => {
    expect((handler as unknown as Record<string, unknown>).diag).toBeUndefined();
  });

  describe('/stats', () => {
    it('sends the statistics as Markdown', async () => {
      const c = ctx();
      await handler.stats(c as never);
      expect(c.sent[0]).toEqual({ text: '*Статистика відключень*', extra: { parse_mode: 'Markdown' } });
    });

    it('tells the user and the admin when it fails', async () => {
      statistics.getStatisticsMessage.mockRejectedValue(new Error('db down'));
      const c = ctx();
      await handler.stats(c as never);
      expect(text(c)).toBe('Помилка при отриманні статистики');
      expect(adminMessages[0]).toContain('db down');
    });
  });
});
