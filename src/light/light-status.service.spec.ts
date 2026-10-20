import { LightStatusService } from './light-status.service';

const exec = <T>(value: T) => ({ exec: async () => value, lean: () => ({ exec: async () => value }) });

describe('LightStatusService', () => {
  let chatIds: number[];
  let history: { timestamp: Date; status: boolean }[];
  let sendMessage: jest.Mock;
  let service: LightStatusService;

  beforeEach(() => {
    chatIds = [1, 2];
    history = [];
    sendMessage = jest.fn().mockResolvedValue(undefined);

    // a single subscription document, kept in chatIds
    const subscriptionModel = {
      findOne: () => exec({ deviceId: 'dev', chatIds }),
      updateOne: (_filter: unknown, update: { $addToSet?: { chatIds: number }; $pull?: { chatIds: number } }) => {
        const before = chatIds.length;
        if (update.$addToSet && !chatIds.includes(update.$addToSet.chatIds)) {
          chatIds = [...chatIds, update.$addToSet.chatIds];
        }
        if (update.$pull) {
          chatIds = chatIds.filter(id => id !== update.$pull!.chatIds);
        }
        return exec({ modifiedCount: chatIds.length !== before ? 1 : 0, upsertedCount: 0 });
      },
    };
    const historyModel = {
      findOne: () => ({ sort: () => exec(history[history.length - 1] ?? null) }),
      create: async (doc: { timestamp: Date; status: boolean }) => history.push(doc),
    };

    service = new LightStatusService(
      { telegram: { sendMessage } } as never,
      subscriptionModel as never,
      historyModel as never,
      { log: jest.fn(), error: jest.fn() } as never,
    );
  });

  describe('applyStatusChange', () => {
    const off = new Date('2026-10-18T13:13:33Z');

    it('records the change at the moment it happened and tells everyone how long the previous state lasted', async () => {
      await service.applyStatusChange('dev', false, off, new Date('2026-10-17T19:06:01Z'), null);

      expect(history).toEqual([{ timestamp: off, status: false }]);
      expect(sendMessage).toHaveBeenCalledTimes(2);
      expect(sendMessage).toHaveBeenCalledWith(1, '🔴 Світло вимкнене\nСвітло було 18 годин 7 хвилин');
    });

    it('appends the schedule line when there is one', async () => {
      const on = new Date('2026-10-18T15:13:33Z');
      await service.applyStatusChange('dev', true, on, off, 'За графіком вимкнуть о 21:00 (через 3 години)');
      expect(sendMessage).toHaveBeenCalledWith(
        2,
        '🟢 Світло увімкнене\nСвітла не було 2 години\nЗа графіком вимкнуть о 21:00 (через 3 години)',
      );
    });

    it('records the very first status without notifying anybody', async () => {
      await service.applyStatusChange('dev', true, off, null, null);
      expect(history).toHaveLength(1);
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('subscriptions', () => {
    it('subscribes once and unsubscribes once', async () => {
      await expect(service.subscribe('dev', 3)).resolves.toBe(true);
      await expect(service.subscribe('dev', 3)).resolves.toBe(false);
      await expect(service.countSubscribers('dev')).resolves.toBe(3);
      await expect(service.unsubscribe('dev', 3)).resolves.toBe(true);
      await expect(service.unsubscribe('dev', 3)).resolves.toBe(false);
    });
  });

  describe('notifySubscribers', () => {
    it.each([
      [403, 'Forbidden: bot was blocked by the user'],
      [403, 'Forbidden: user is deactivated'],
      [400, 'Bad Request: chat not found'],
    ])('unsubscribes a chat that is gone (%i %s)', async (code, description) => {
      sendMessage.mockImplementation(async (chatId: number) => {
        if (chatId === 1) {
          throw Object.assign(new Error(description), { response: { error_code: code, description } });
        }
      });
      await service.notifySubscribers('dev', 'hi');
      expect(chatIds).toEqual([2]);
    });

    it('keeps a chat on any other error, and still reaches the rest', async () => {
      sendMessage.mockImplementation(async (chatId: number) => {
        if (chatId === 1) {
          throw Object.assign(new Error('Too Many Requests'), { response: { error_code: 429 } });
        }
      });
      await service.notifySubscribers('dev', 'hi');
      expect(chatIds).toEqual([1, 2]);
      expect(sendMessage).toHaveBeenCalledWith(2, 'hi');
    });
  });
});
