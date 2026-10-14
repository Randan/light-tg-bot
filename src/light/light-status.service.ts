import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { LoggerService } from '@randan/tg-logger';
import type { Model } from 'mongoose';
import { InjectBot } from 'nestjs-telegraf';
import type { Telegraf } from 'telegraf';

import { formatTime } from './format-time.util';
import { LightHistoryDoc } from './schemas/light-history.schema';
import { LightRecord } from './schemas/light-record.schema';

@Injectable()
export class LightStatusService {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    @InjectModel(LightRecord.name) private readonly lightRecordModel: Model<LightRecord>,
    @InjectModel(LightHistoryDoc.name) private readonly lightHistoryModel: Model<LightHistoryDoc>,
    private readonly logger: LoggerService,
  ) {}

  async getLastHistoryEntry(): Promise<{ timestamp: Date; status: boolean } | null> {
    return this.lightHistoryModel.findOne().sort({ timestamp: -1 }).lean().exec();
  }

  /**
   * Records a status change and notifies the subscribers.
   * With no previous entry (fresh database) it only records the initial status:
   * there is no real change to report yet.
   */
  async applyStatusChange(deviceId: string, status: boolean, previousChangeAt: Date | null): Promise<void> {
    await this.lightHistoryModel.create({ timestamp: new Date(), status });
    this.logger.log(`[HISTORY] Added: light ${status ? 'ON' : 'OFF'}`);

    if (!previousChangeAt) {
      this.logger.log('[HISTORY] Initial status recorded, nobody notified');
      return;
    }

    const timeFormatted = formatTime(Date.now() - new Date(previousChangeAt).getTime());
    const message = status
      ? `🟢 Світло увімкнене\nСвітла не було ${timeFormatted}`
      : `🔴 Світло вимкнене\nСвітло було ${timeFormatted}`;

    const record = await this.lightRecordModel.findOne({ deviceId }).lean().exec();
    const userIds = record?.userIds ?? [];

    await Promise.all(userIds.map(id => this.sendSafely(deviceId, id, message)));
    this.logger.log(`[NOTIFY] Sent status change to ${userIds.length} subscribers`);
  }

  /** Returns false when the chat was already subscribed. */
  async subscribe(deviceId: string, chatId: number): Promise<boolean> {
    const result = await this.lightRecordModel
      .updateOne({ deviceId }, { $addToSet: { userIds: chatId } }, { upsert: true })
      .exec();
    return result.modifiedCount > 0 || result.upsertedCount > 0;
  }

  /** Returns false when the chat was not subscribed. */
  async unsubscribe(deviceId: string, chatId: number): Promise<boolean> {
    const result = await this.lightRecordModel.updateOne({ deviceId }, { $pull: { userIds: chatId } }).exec();
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
