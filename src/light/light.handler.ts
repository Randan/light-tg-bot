import { ConfigService } from '@nestjs/config';
import { AdminService } from '@randan/tg-bot-kit';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import { Command, Ctx, Update } from 'nestjs-telegraf';
import type { Context } from 'telegraf';

import { formatTime } from './format-time.util';
import { LightCronService } from './light-cron.service';
import { LightScheduleService } from './light-schedule.service';
import { LightStatisticsService } from './light-statistics.service';
import { LightStatusService } from './light-status.service';
import { LightTuyaService } from './light-tuya.service';
import type { ScheduleDay } from './schedule-format.util';
import { describeDay, formatDate, zonedNow } from './schedule-format.util';

const HELP_TEXT =
  '👋 *Вітаю!*\n\n' +
  'Я бот, який автоматично відстежує стан електропостачання та повідомляє про зміни.\n\n' +
  '📋 *Доступні команди:*\n\n' +
  '🔔 *Сповіщення:*\n' +
  '/start - підписатися на сповіщення про світло\n' +
  '/stop - відписатися від сповіщень\n\n' +
  '🔍 *Перевірка статусу:*\n' +
  '/status - чи є світло зараз\n' +
  '/schedule - графік відключень ДТЕК на сьогодні й завтра\n\n' +
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
    private readonly schedule: LightScheduleService,
    private readonly admin: AdminService,
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
      const scheduleLine = await this.schedule.describeNextChange(lastHistoryEntry.status);
      if (scheduleLine) {
        lines.push(scheduleLine);
      }

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
    if (!chatId || !this.admin.isAdmin(ctx)) {
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
    } else if (outcome === 'pending') {
      const state = lastCheck?.status ? '🟢 Розетка онлайн' : '🔴 Розетка офлайн';
      message = `${state}, але це ще не підтверджено: зміну буде записано, якщо наступна перевірка покаже те саме`;
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

  @Command('schedule')
  async scheduleCommand(@Ctx() ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    try {
      await ctx.telegram.sendMessage(chatId, await this.describeSchedule());
    } catch (err) {
      this.logger.error('Failed to describe the schedule', err);
      await ctx.telegram.sendMessage(chatId, 'Помилка при отриманні графіка');
    }
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

  /** Everything known about the schedule right now; says so plainly when nothing is. */
  private async describeSchedule(): Promise<string> {
    if (!this.schedule.isConfigured()) {
      return 'Графік відключень не налаштовано: не вказано адресу.';
    }

    const { today, tomorrow } = await this.schedule.getCurrent();
    const lastPoll = this.schedule.getLastPoll();

    if (!today && !tomorrow) {
      const reason = lastPoll?.error ? `YASNO не відповідає (${lastPoll.error})` : 'дані від YASNO ще не отримано';
      return `Немає інформації про графік: ${reason}.`;
    }

    const group = (today ?? tomorrow)!.group;
    const describe = (title: string, day: ScheduleDay | null) => `${title}:\n${day ? describeDay(day) : 'Немає даних'}`;
    const tz = this.timeZone();
    const lines = [
      `📅 Графік відключень ДТЕК (група ${group})`,
      '',
      describe(`Сьогодні (${formatDate(zonedNow(tz).date)})`, today),
      '',
      describe(`Завтра${tomorrow ? ` (${formatDate(tomorrow.date)})` : ''}`, tomorrow),
      '',
    ];

    const updatedOn = (tomorrow ?? today)?.updatedOn;
    if (updatedOn) {
      lines.push(`Оновлено YASNO: ${this.formatDateTime(updatedOn)}`);
    }
    const lastSuccessAt = this.schedule.getLastSuccessAt();
    if (lastSuccessAt && this.schedule.isFresh()) {
      lines.push(`Перевірено: ${this.formatDateTime(lastSuccessAt)}`);
    } else {
      lines.push('⚠️ Не вдається отримати свіжі дані від YASNO, показую останні збережені');
    }

    return lines.join('\n');
  }

  private formatDateTime(date: Date): string {
    return new Date(date).toLocaleString('uk-UA', {
      timeZone: this.timeZone(),
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private timeZone(): string {
    return this.config.get<string>('TIMEZONE') || 'Europe/Kyiv';
  }

  private getDeviceId(): string {
    return this.config.get<string>('TUYA_DEVICE_ID')!;
  }
}
