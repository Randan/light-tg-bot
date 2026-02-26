import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { LoggerService } from '@randan/tg-logger';
import type { Model } from 'mongoose';
import { InjectBot } from 'nestjs-telegraf';
import type { Telegraf } from 'telegraf';

import { formatTime } from './format-time.util';
import type { LightCacheService, LightRecordData } from './light-cache.service';
import { LightHistoryDoc } from './schemas/light-history.schema';
import { LightRecord } from './schemas/light-record.schema';

@Injectable()
export class LightStatusService {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    @InjectModel(LightRecord.name) private readonly lightRecordModel: Model<LightRecord>,
    @InjectModel(LightHistoryDoc.name) private readonly lightHistoryModel: Model<LightHistoryDoc>,
    private readonly cache: LightCacheService,
    private readonly logger: LoggerService,
  ) {}

  async onLightStatusChange(record: LightRecordData, isAutomatic: boolean, lastHistoryTimestamp?: Date): Promise<void> {
    const { status, userIds, deviceId } = record;

    let message: string;
    if (isAutomatic && lastHistoryTimestamp) {
      const delta = Date.now() - new Date(lastHistoryTimestamp).getTime();
      const timeFormatted = formatTime(delta);
      message = status
        ? `🟢 Світло увімкнене\nСвітла не було ${timeFormatted}`
        : `🔴 Світло вимкнене\nСвітло було ${timeFormatted}`;
    } else {
      message = status ? '🟢 Світло є' : '🔴 Світла немає';
    }

    try {
      await Promise.all(
        userIds.map(id =>
          this.bot.telegram.sendMessage(id, message).catch(err => {
            this.logger.error(`Failed to send message to user ${id}`, err);
            return Promise.resolve();
          }),
        ),
      );

      await this.lightRecordModel.updateOne({ deviceId }, { status }).exec();

      if (isAutomatic) {
        await this.lightHistoryModel.create({ timestamp: new Date(), status });
        this.logger.log(`[HISTORY] Added: light ${status ? 'ON' : 'OFF'}`);
      }

      this.cache.updateCache().catch(err => {
        this.logger.error('Failed to update light records cache', err);
      });
    } catch (err) {
      this.logger.error('Failed to update light status', err);
      throw err;
    }
  }
}
