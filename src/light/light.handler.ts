import { Command, Ctx, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { LightTuyaService } from './light-tuya.service';
import { LightStatusService } from './light-status.service';
import { LightStatisticsService } from './light-statistics.service';
import { LightCacheService } from './light-cache.service';
import { formatTime } from './format-time.util';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../common/logger/logger.service';
import { NotifyAdminService } from '../common/notify-admin/notify-admin.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LightHistoryDoc } from './schemas/light-history.schema';

const HELP_TEXT =
  '👋 *Вітаю!*\n\n' +
  'Я бот, який автоматично відстежує стан електрохарчування та повідомляє про зміни.\n\n' +
  '📋 *Доступні команди:*\n\n' +
  '🔍 *Перевірка статусу:*\n' +
  '/status - перевірити, чи є світло зараз\n\n' +
  '📊 *Статистика відключень:*\n' +
  '/stats - статистика по періодах (сьогодні, тиждень, місяць тощо)\n\n' +
  'ℹ️ *Допомога:*\n' +
  '/help - показати це повідомлення\n\n' +
  '💪 *Разом до Перемоги!* 🇺🇦';

@Update()
export class LightHandler {
  constructor(
    private readonly config: ConfigService,
    private readonly tuya: LightTuyaService,
    private readonly lightStatus: LightStatusService,
    private readonly statistics: LightStatisticsService,
    private readonly cache: LightCacheService,
    @InjectModel(LightHistoryDoc.name)
    private readonly lightHistoryModel: Model<LightHistoryDoc>,
    private readonly logger: LoggerService,
    private readonly notifyAdmin: NotifyAdminService,
  ) {}

  @Command('help')
  async help(@Ctx() ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await ctx.telegram.sendMessage(chatId, HELP_TEXT, {
      parse_mode: 'Markdown',
    });
  }

  @Command('status')
  async checkStatus(@Ctx() ctx: Context): Promise<void> {
    const from = ctx.from;
    const chatId = ctx.chat?.id;
    if (!from || !chatId) return;

    const id = from.id;
    const deviceId = this.config.get<string>('TUYA_DEVICE_ID');
    if (!deviceId) {
      await ctx.telegram.sendMessage(chatId, 'Помилка: TUYA_DEVICE_ID не налаштовано');
      this.logger.error('[USER REQUEST] TUYA_DEVICE_ID is not configured');
      this.notifyAdmin.send('🚨 TUYA_DEVICE_ID is not configured', {
        parse_mode: 'Markdown',
      });
      return;
    }

    this.logger.log(`[USER REQUEST] User ${id} requested status check`);
    await ctx.telegram.sendMessage(chatId, 'Перевіряю статус...');

    try {
      const deviceStatus = await this.tuya.getDeviceStatus(deviceId);
      const lastHistoryEntry = await this.lightHistoryModel
        .findOne()
        .sort({ timestamp: -1 })
        .lean()
        .exec();
      const canShowDuration =
        lastHistoryEntry && lastHistoryEntry.status === deviceStatus;
      const durationLine = canShowDuration
        ? `\n${formatTime(Date.now() - new Date(lastHistoryEntry!.timestamp).getTime())}`
        : '';
      const message = deviceStatus
        ? `🟢 Світло є${durationLine}`
        : `🔴 Світла немає${durationLine}`;
      await ctx.telegram.sendMessage(chatId, message);
    } catch (err) {
      this.logger.error('[USER REQUEST] Failed to check status', err);
      await ctx.telegram.sendMessage(chatId, 'Помилка при перевірці статусу');
      this.notifyAdmin.send(
        `🚨 Status check failed: ${err instanceof Error ? err.message : String(err)}`,
        { parse_mode: 'Markdown' },
      );
    }
  }

  @Command('stats')
  async stats(@Ctx() ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    try {
      const message = await this.statistics.getStatisticsMessage();
      await ctx.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      this.logger.error('Failed to get statistics', err);
      await ctx.telegram.sendMessage(chatId, 'Помилка при отриманні статистики');
      this.notifyAdmin.send(
        `🚨 Stats failed: ${err instanceof Error ? err.message : String(err)}`,
        { parse_mode: 'Markdown' },
      );
    }
  }
}
