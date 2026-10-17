import type { OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';

import { FailureAlert } from './failure-alert.util';
import { LightScheduleService } from './light-schedule.service';
import { LightStatusService } from './light-status.service';
import { LightTuyaService } from './light-tuya.service';
import { isNetworkAvailable } from './network.util';

const NO_NETWORK_LOG_INTERVAL_MS = 5 * 60 * 1000;

/** A poll loop that has not finished a round in this many intervals is stuck. */
const STUCK_AFTER_INTERVALS = 3;

export interface LightCheck {
  status: boolean;
  checkedAt: Date;
}

/** What a poll ended with. `pending` is a change seen once, waiting for the next poll to confirm it. */
export type PollOutcome = 'busy' | 'no-network' | 'unknown' | 'failed' | 'unchanged' | 'pending' | 'changed';

@Injectable()
export class LightCronService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private lastNoNetworkLogAt = 0;
  private lastCheck: LightCheck | null = null;
  /** A status that differs from the history, seen once: one reading may be a Wi-Fi blip. */
  private pendingChange: LightCheck | null = null;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();
  private lastRoundAt: number | null = null;
  private readonly alert: FailureAlert;

  constructor(
    private readonly config: ConfigService,
    private readonly tuya: LightTuyaService,
    private readonly status: LightStatusService,
    private readonly schedule: LightScheduleService,
    private readonly logger: LoggerService,
    notifyAdmin: NotifyAdminService,
  ) {
    this.alert = new FailureAlert(message => notifyAdmin.send(message), '✅ Перевірка світла знову працює');
  }

  onModuleInit(): void {
    const interval = this.getPollIntervalMinutes();
    // a plain interval: a cron step like */7 leaves a short gap at every hour
    this.timer = setInterval(() => void this.pollDeviceStatus(), interval * 60 * 1000);
    this.logger.log(`Light status polling registered (every ${interval} minutes)`);
  }

  onApplicationBootstrap(): void {
    void this.pollDeviceStatus();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  getPollIntervalMinutes(): number {
    return this.config.get<number>('TUYA_POLL_INTERVAL_MINUTES', 3);
  }

  /** The last successful Tuya answer; null until the first one arrives. */
  getLastCheck(): LightCheck | null {
    return this.lastCheck;
  }

  /** False when the poll loop has not finished a round for a while: it is stuck. */
  isPolling(): boolean {
    const stuckAfterMs = this.getPollIntervalMinutes() * STUCK_AFTER_INTERVALS * 60 * 1000;
    return Date.now() - (this.lastRoundAt ?? this.startedAt) <= stuckAfterMs;
  }

  async pollDeviceStatus(): Promise<PollOutcome> {
    if (this.running) {
      this.logger.warn('[CRON] Previous check still running, skipping');
      return 'busy';
    }
    this.running = true;

    try {
      if (!(await isNetworkAvailable(this.config.get<string>('TUYA_BASE_URL')))) {
        const now = Date.now();
        if (now - this.lastNoNetworkLogAt >= NO_NETWORK_LOG_INTERVAL_MS) {
          this.logger.warn('[CRON] Skipping status check: no network');
          this.lastNoNetworkLogAt = now;
        }
        return 'no-network';
      }

      const deviceId = this.config.get<string>('TUYA_DEVICE_ID')!;
      const isOnline = await this.tuya.isDeviceOnline(deviceId);
      if (isOnline === null) {
        this.logger.error('[CRON] Device status is UNKNOWN (Tuya API failure), skipping this check');
        return 'unknown';
      }
      const check: LightCheck = { status: isOnline, checkedAt: new Date() };
      this.lastCheck = check;

      const lastHistoryEntry = await this.status.getLastHistoryEntry();
      if (lastHistoryEntry?.status === isOnline) {
        this.pendingChange = null;
        this.alert.ok();
        return 'unchanged';
      }

      // the very first status has nothing to confirm against a change
      if (lastHistoryEntry && this.pendingChange?.status !== isOnline) {
        this.pendingChange = check;
        this.logger.log(`[CRON] Status looks changed to ${isOnline}, confirming on the next check`);
        this.alert.ok();
        return 'pending';
      }

      // the change happened when it was first seen, not when it was confirmed
      const changedAt = this.pendingChange?.checkedAt ?? check.checkedAt;
      this.pendingChange = null;
      this.logger.log(`[CRON] Status changed: ${lastHistoryEntry?.status ?? 'none'} -> ${isOnline}`);
      const scheduleLine = await this.describeScheduleSafely(isOnline);
      await this.status.applyStatusChange(
        deviceId,
        isOnline,
        changedAt,
        lastHistoryEntry?.timestamp ?? null,
        scheduleLine,
      );
      this.alert.ok();
      return 'changed';
    } catch (err) {
      this.logger.error('[CRON] Error in pollDeviceStatus', err);
      this.alert.fail(`🚨 Light cron error: ${err instanceof Error ? err.message : String(err)}`);
      return 'failed';
    } finally {
      this.lastRoundAt = Date.now();
      this.running = false;
    }
  }

  /** A schedule failure must not stop the power change from being announced. */
  private async describeScheduleSafely(isPowerOn: boolean): Promise<string | null> {
    try {
      return await this.schedule.describeNextChange(isPowerOn);
    } catch (err) {
      this.logger.error('[CRON] Failed to describe the schedule', err);
      return null;
    }
  }
}
