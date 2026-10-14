import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { LoggerService } from '@randan/tg-logger';
import type { Model } from 'mongoose';
import { InjectBot } from 'nestjs-telegraf';
import type { Telegraf } from 'telegraf';

import { formatTime } from './format-time.util';
import { LightHistory } from './schemas/light-history.schema';
import { LightSubscription } from './schemas/light-subscription.schema';

@Injectable()
export class LightStatusService {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    @InjectModel(LightSubscription.name) private readonly subscriptionModel: Model<LightSubscription>,
    @InjectModel(LightHistory.name) private readonly historyModel: Model<LightHistory>,
    private readonly logger: LoggerService,
  ) {}

  async getLastHistoryEntry(): Promise<{ timestamp: Date; status: boolean } | null> {
    return this.historyModel.findOne().sort({ timestamp: -1 }).lean().exec();
  }

  /**
   * Records a status change and notifies the subscribers.
   * With no previous entry (fresh database) it only records the initial status:
   * there is no real change to report yet.
   */
  async applyStatusChange(deviceId: string, status: boolean, previousChangeAt: Date | null): Promise<void> {
    await this.historyModel.create({ timestamp: new Date(), status });
    this.logger.log(`[HISTORY] Added: light ${status ? 'ON' : 'OFF'}`);

    if (!previousChangeAt) {
      this.logger.log('[HISTORY] Initial status recorded, nobody notified');
      return;
    }

    const timeFormatted = formatTime(Date.now() - new Date(previousChangeAt).getTime());
    const message = status
      ? `🟢 Світло увімкнене\nСвітла не було ${timeFormatted}`
      : `🔴 Світло вимкнене\nСвітло було ${timeFormatted}`;

    const subscription = await this.subscriptionModel.findOne({ deviceId }).lean().exec();
    const chatIds = subscription?.chatIds ?? [];

    await Promise.all(chatIds.map(id => this.sendSafely(deviceId, id, message)));
    this.logger.log(`[NOTIFY] Sent status change to ${chatIds.length} subscribers`);
  }

  /** Returns false when the chat was already subscribed. */
  async subscribe(deviceId: string, chatId: number): Promise<boolean> {
    const result = await this.subscriptionModel
      .updateOne({ deviceId }, { $addToSet: { chatIds: chatId } }, { upsert: true })
      .exec();
    return result.modifiedCount > 0 || result.upsertedCount > 0;
  }

  /** Returns false when the chat was not subscribed. */
  async unsubscribe(deviceId: string, chatId: number): Promise<boolean> {
    const result = await this.subscriptionModel.updateOne({ deviceId }, { $pull: { chatIds: chatId } }).exec();
    return result.modifiedCount > 0;
  }

  private async sendSafely(deviceId: string, chatId: number, message: string): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(chatId, message);
    } catch (err) {
      const code = (err as { response?: { error_code?: number } }).response?.error_code;
      if (code === 403) {
        await this.unsubscribe(deviceId, chatId);
        this.logger.log(`[NOTIFY] Chat ${chatId} blocked the bot, unsubscribed`);
        return;
      }
      this.logger.error(`Failed to send message to chat ${chatId}`, err);
    }
  }
}
