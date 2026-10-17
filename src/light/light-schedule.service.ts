import type { OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import type { Model } from 'mongoose';

import { FailureAlert } from './failure-alert.util';
import { LightStatusService } from './light-status.service';
import type { ScheduleDay } from './schedule-format.util';
import {
  describeChange,
  formatDate,
  formatDurationAfter,
  formatMinutes,
  scheduledTurnOff,
  scheduledTurnOn,
  ScheduleStatus,
  zonedNow,
  zonedTomorrow,
} from './schedule-format.util';
import { OutageSchedule } from './schemas/outage-schedule.schema';
import type { YasnoDay } from './yasno.service';
import { YasnoService } from './yasno.service';

/** A schedule last fetched more than this many poll intervals ago may be out of date. */
const STALE_AFTER_INTERVALS = 3;

export interface SchedulePoll {
  at: Date;
  error: string | null;
}

@Injectable()
export class LightScheduleService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private lastPoll: SchedulePoll | null = null;
  private lastSuccessAt: Date | null = null;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly alert: FailureAlert;

  constructor(
    private readonly config: ConfigService,
    private readonly yasno: YasnoService,
    @InjectModel(OutageSchedule.name) private readonly scheduleModel: Model<OutageSchedule>,
    private readonly status: LightStatusService,
    private readonly logger: LoggerService,
    notifyAdmin: NotifyAdminService,
  ) {
    this.alert = new FailureAlert(message => notifyAdmin.send(message), '✅ YASNO знову віддає графік');
  }

  onModuleInit(): void {
    if (!this.yasno.isConfigured()) {
      this.logger.warn('YASNO schedule is disabled: set YASNO_STREET_ID + YASNO_HOUSE_ID or YASNO_GROUP');
      return;
    }
    const interval = this.getPollIntervalMinutes();
    this.timer = setInterval(() => void this.poll(), interval * 60 * 1000);
    this.logger.log(`YASNO schedule polling registered (every ${interval} minutes)`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  onApplicationBootstrap(): void {
    if (this.yasno.isConfigured()) {
      void this.poll();
    }
  }

  isConfigured(): boolean {
    return this.yasno.isConfigured();
  }

  getPollIntervalMinutes(): number {
    return this.config.get<number>('YASNO_POLL_INTERVAL_MINUTES', 10);
  }

  getLastPoll(): SchedulePoll | null {
    return this.lastPoll;
  }

  getLastSuccessAt(): Date | null {
    return this.lastSuccessAt;
  }

  /** Whether the stored schedule was confirmed by YASNO recently enough to rely on. */
  isFresh(): boolean {
    const staleAfterMs = this.getPollIntervalMinutes() * STALE_AFTER_INTERVALS * 60 * 1000;
    return this.lastSuccessAt !== null && Date.now() - this.lastSuccessAt.getTime() <= staleAfterMs;
  }

  /** The current schedule for today and tomorrow (Kyiv dates), as last stored. */
  async getCurrent(): Promise<{ today: ScheduleDay | null; tomorrow: ScheduleDay | null }> {
    const tz = this.timeZone();
    const [today, tomorrow] = await Promise.all([this.getLatest(zonedNow(tz).date), this.getLatest(zonedTomorrow(tz))]);
    return { today, tomorrow };
  }

  /**
   * One line on when the schedule changes the power next: the turn-off while
   * it is on, the turn-on while it is off. Null when the schedule says nothing
   * about it or the stored schedule may be out of date, so callers can leave
   * the line out.
   */
  async describeNextChange(isPowerOn: boolean): Promise<string | null> {
    if (!this.isConfigured() || !this.isFresh()) {
      return null;
    }
    const { today, tomorrow } = await this.getCurrent();
    if (today?.status === ScheduleStatus.Emergency) {
      return '🚨 Діють екстрені відключення, графік не діє';
    }

    const now = zonedNow(this.timeZone()).minutes;
    const at = isPowerOn ? scheduledTurnOff(today, tomorrow, now) : scheduledTurnOn(today, tomorrow, now);
    if (at === null) {
      return null;
    }
    const action = isPowerOn ? 'вимкнуть' : 'мають увімкнути';
    const day = at >= 24 * 60 ? ' завтра' : '';
    return `За графіком ${action}${day} о ${formatMinutes(at % (24 * 60))} (через ${formatDurationAfter(at - now)})`;
  }

  async poll(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    try {
      const group = await this.resolveGroup();
      const schedule = await this.yasno.getGroupSchedule(group);

      await this.storeIfChanged('сьогодні', schedule.today, group, schedule.updatedOn);
      await this.storeIfChanged('завтра', schedule.tomorrow, group, schedule.updatedOn);

      this.lastPoll = { at: new Date(), error: null };
      this.lastSuccessAt = this.lastPoll.at;
      this.alert.ok();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastPoll = { at: new Date(), error: message };
      this.logger.error('[YASNO] Schedule poll failed', message);
      this.alert.fail(`🚨 YASNO schedule poll failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * YASNO_GROUP wins. Otherwise the group is looked up by address, so a building
   * moved to another group is noticed; when the lookup fails (YASNO renumbered
   * the houses on 2026-10-17 and the stored house id stopped resolving) the
   * last stored group is used without alerting the admin on every poll.
   */
  private async resolveGroup(): Promise<string> {
    const fixedGroup = this.config.get<string>('YASNO_GROUP');
    if (fixedGroup) {
      return fixedGroup;
    }
    try {
      return await this.yasno.resolveGroup();
    } catch (err) {
      const last = await this.scheduleModel.findOne().sort({ fetchedAt: -1 }).select('group').lean().exec();
      if (!last) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[YASNO] Group lookup failed, using the last stored group ${last.group}: ${message}`);
      return last.group;
    }
  }

  /**
   * Stores a new version when the day's schedule differs from the last stored
   * one, and tells the subscribers. The first version seen for a date is stored
   * silently: there is nothing to compare it with.
   */
  private async storeIfChanged(dayLabel: string, day: YasnoDay, group: string, updatedOn?: Date): Promise<void> {
    const previous = await this.getLatest(day.date);
    const current: ScheduleDay = { ...day, group, updatedOn };
    if (previous && this.isSame(previous, current)) {
      return;
    }

    await this.scheduleModel.create({ ...current, fetchedAt: new Date() });
    this.logger.log(`[YASNO] Stored schedule for ${day.date}: ${day.status}, ${day.slots.length} slots`);

    if (previous) {
      const message = describeChange(`${dayLabel} (${formatDate(day.date)})`, current, previous);
      await this.status.notifySubscribers(this.config.get<string>('TUYA_DEVICE_ID')!, message);
    }
  }

  private isSame(a: ScheduleDay, b: ScheduleDay): boolean {
    const slotsKey = (day: ScheduleDay) => JSON.stringify(day.slots.map(s => [s.start, s.end, s.type]));
    return a.status === b.status && a.group === b.group && slotsKey(a) === slotsKey(b);
  }

  private async getLatest(date: string): Promise<ScheduleDay | null> {
    return this.scheduleModel.findOne({ date }).sort({ fetchedAt: -1 }).lean().exec();
  }

  private timeZone(): string {
    return this.config.get<string>('TIMEZONE') || 'Europe/Kyiv';
  }
}
