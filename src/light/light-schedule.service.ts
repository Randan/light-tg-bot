import type { OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import type { Model } from 'mongoose';
import * as cron from 'node-cron';

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

/** Do not notify the admin about the same ongoing YASNO failure more than once per hour. */
const ERROR_NOTIFY_INTERVAL_MS = 60 * 60 * 1000;

export interface SchedulePoll {
  at: Date;
  error: string | null;
}

@Injectable()
export class LightScheduleService implements OnModuleInit, OnApplicationBootstrap {
  private lastPoll: SchedulePoll | null = null;
  private lastSuccessAt: Date | null = null;
  private lastErrorNotifiedAt = 0;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly yasno: YasnoService,
    @InjectModel(OutageSchedule.name) private readonly scheduleModel: Model<OutageSchedule>,
    private readonly status: LightStatusService,
    private readonly logger: LoggerService,
    private readonly notifyAdmin: NotifyAdminService,
  ) {}

  onModuleInit(): void {
    if (!this.yasno.isConfigured()) {
      this.logger.warn('YASNO schedule is disabled: set YASNO_STREET_ID + YASNO_HOUSE_ID or YASNO_GROUP');
      return;
    }
    const interval = this.getPollIntervalMinutes();
    cron.schedule(`*/${interval} * * * *`, () => this.poll(), { timezone: this.timeZone() });
    this.logger.log(`YASNO schedule cron registered (every ${interval} minutes)`);
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

  /** The current schedule for today and tomorrow (Kyiv dates), as last stored. */
  async getCurrent(): Promise<{ today: ScheduleDay | null; tomorrow: ScheduleDay | null }> {
    const tz = this.timeZone();
    const [today, tomorrow] = await Promise.all([this.getLatest(zonedNow(tz).date), this.getLatest(zonedTomorrow(tz))]);
    return { today, tomorrow };
  }

  /**
   * One line on when the schedule changes the power next: the turn-off while
   * it is on, the turn-on while it is off. Null when the schedule says nothing
   * about it, so callers can leave the line out.
   */
  async describeNextChange(isPowerOn: boolean): Promise<string | null> {
    if (!this.isConfigured()) {
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
      const { group, warning } = await this.resolveGroup();
      const schedule = await this.yasno.getGroupSchedule(group);

      await this.storeIfChanged('сьогодні', schedule.today, group, schedule.updatedOn);
      await this.storeIfChanged('завтра', schedule.tomorrow, group, schedule.updatedOn);

      this.lastPoll = { at: new Date(), error: warning };
      this.lastSuccessAt = this.lastPoll.at;
      if (warning) {
        this.reportError(warning);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastPoll = { at: new Date(), error: message };
      this.reportError(message);
    } finally {
      this.running = false;
    }
  }

  /**
   * The group lookup by address is a separate YASNO call that can fail on its
   * own; the schedule itself is still worth fetching for the last known group.
   */
  private async resolveGroup(): Promise<{ group: string; warning: string | null }> {
    try {
      return { group: await this.yasno.resolveGroup(), warning: null };
    } catch (err) {
      const last = await this.scheduleModel.findOne().sort({ fetchedAt: -1 }).select('group').lean().exec();
      if (!last) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      return { group: last.group, warning: `${message} (using the last known group ${last.group})` };
    }
  }

  private reportError(message: string): void {
    this.logger.error('[YASNO] Schedule poll failed', message);
    if (Date.now() - this.lastErrorNotifiedAt >= ERROR_NOTIFY_INTERVAL_MS) {
      this.lastErrorNotifiedAt = Date.now();
      this.notifyAdmin.send(`🚨 YASNO schedule poll failed: ${message}`);
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
