import { ConfigService } from '@nestjs/config';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import { Command, Ctx, Update } from 'nestjs-telegraf';
import type { Context } from 'telegraf';

import { formatTime } from './format-time.util';
import { LightCronService } from './light-cron.service';
import { LightStatisticsService } from './light-statistics.service';
import { LightStatusService } from './light-status.service';
import { LightTuyaService } from './light-tuya.service';

const HELP_TEXT =
  '👋 *Вітаю!*\n\n' +
  'Я бот, який автоматично відстежує стан електропостачання та повідомляє про зміни.\n\n' +
  '📋 *Доступні команди:*\n\n' +
  '🔔 *Сповіщення:*\n' +
  '/start - підписатися на сповіщення про світло\n' +
  '/stop - відписатися\n\n' +
  '🔍 *Перевірка статусу:*\n' +
  '/status - чи є світло зараз\n\n' +
  '📊 *Статистика відключень:*\n' +
  '/stats - статистика по періодах (сьогодні, тиждень, місяць тощо)\n\n' +
  'ℹ️ *Допомога:*\n' +
  '/help - показати це повідомлення\n\n' +
  '💪 *Разом до Перемоги!* 🇺🇦';

/** A check older than this many poll intervals means Tuya has not answered for a while. */
const STALE_CHECK_INTERVALS = 3;

@Update()
export class LightHandler {
  constructor(
    private readonly config: ConfigService,
    private readonly lightStatus: LightStatusService,
    private readonly cron: LightCronService,
    private readonly statistics: LightStatisticsService,
    private readonly tuya: LightTuyaService,
    private readonly logger: LoggerService,
    private readonly notifyAdmin: NotifyAdminService,
  ) {}

  @Command('help')
  async help(@Ctx() ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }
    await ctx.telegram.sendMessage(chatId, HELP_TEXT, {
      parse_mode: 'Markdown',
    });
  }

  @Command('start')
  async start(@Ctx() ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    try {
      const added = await this.lightStatus.subscribe(this.getDeviceId(), chatId);
      await ctx.telegram.sendMessage(
        chatId,
        added
          ? '🔔 Готово! Повідомлю, щойно світло зникне або з’явиться.\n\n/help - список команд'
          : 'Ви вже підписані на сповіщення 🙂',
      );
    } catch (err) {
      this.logger.error('Failed to subscribe', err);
      await ctx.telegram.sendMessage(chatId, 'Не вдалося підписатися, спробуй пізніше');
    }
  }

  @Command('stop')
  async stop(@Ctx() ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    try {
      const removed = await this.lightStatus.unsubscribe(this.getDeviceId(), chatId);
      await ctx.telegram.sendMessage(
        chatId,
        removed ? '🔕 Сповіщення вимкнено. /start - щоб увімкнути знову' : 'Ви й так не підписані',
      );
    } catch (err) {
      this.logger.error('Failed to unsubscribe', err);
      await ctx.telegram.sendMessage(chatId, 'Не вдалося відписатися, спробуй пізніше');
    }
  }

  /**
   * Answers from the data the cron already collected: a live Tuya call per
   * request would let users burn through the monthly API quota.
   */
  @Command('status')
  async status(@Ctx() ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    try {
      const lastHistoryEntry = await this.lightStatus.getLastHistoryEntry();
      if (!lastHistoryEntry) {
        await ctx.telegram.sendMessage(chatId, 'Ще немає даних. Спробуй за кілька хвилин.');
        return;
      }

      const since = formatTime(Date.now() - new Date(lastHistoryEntry.timestamp).getTime());
      const lines = [lastHistoryEntry.status ? `🟢 Світло є\n${since}` : `🔴 Світла немає\n${since}`];

      const lastCheck = this.cron.getLastCheck();
      const staleAfterMs = this.cron.getPollIntervalMinutes() * STALE_CHECK_INTERVALS * 60 * 1000;
      if (!lastCheck || Date.now() - lastCheck.checkedAt.getTime() > staleAfterMs) {
        lines.push('\n⚠️ Не вдається отримати свіжі дані від Tuya, статус може бути застарілим');
      }

      await ctx.telegram.sendMessage(chatId, lines.join('\n'));
    } catch (err) {
      this.logger.error('[USER REQUEST] Failed to check status', err);
      await ctx.telegram.sendMessage(chatId, 'Помилка при перевірці статусу');
      this.notifyAdmin.send(`🚨 Status check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Admin-only and unlisted: polls Tuya right now, through the same path as the
   * cron, so a detected change is recorded and announced as usual. Anyone else
   * is ignored silently, so the command cannot be used to drain the API quota.
   */
  @Command('statusrequest')
  async statusRequest(@Ctx() ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    const adminId = this.config.get<string>('ADMIN_TELEGRAM_ID');
    if (!chatId || !adminId || String(ctx.from?.id) !== adminId) {
      return;
    }

    const outcome = await this.cron.pollDeviceStatus();
    const lastCheck = this.cron.getLastCheck();

    let message: string;
    if (outcome === 'changed' || outcome === 'unchanged') {
      const state = lastCheck?.status ? '🟢 Розетка онлайн — світло є' : '🔴 Розетка офлайн — світла немає';
      message =
        outcome === 'changed'
          ? `${state}
Статус змінився, записано в історію`
          : state;
    } else if (outcome === 'unknown') {
      message = `⚠️ Tuya не відповіла: ${this.tuya.getLastError() ?? 'невідома помилка'}`;
    } else if (outcome === 'busy') {
      message = 'Перевірка вже триває, спробуй за хвилину';
    } else if (outcome === 'no-network') {
      message = '⚠️ На сервері немає інтернету';
    } else {
      message = '⚠️ Перевірка впала, деталі в логах';
    }

    await ctx.telegram.sendMessage(chatId, message);
  }

  @Command('stats')
  async stats(@Ctx() ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    try {
      const message = await this.statistics.getStatisticsMessage();
      await ctx.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      this.logger.error('Failed to get statistics', err);
      await ctx.telegram.sendMessage(chatId, 'Помилка при отриманні статистики');
      this.notifyAdmin.send(`🚨 Stats failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private getDeviceId(): string {
    return this.config.get<string>('TUYA_DEVICE_ID')!;
  }
}
