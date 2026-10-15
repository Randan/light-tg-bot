import type { OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import * as cron from 'node-cron';

import { LightScheduleService } from './light-schedule.service';
import { LightStatusService } from './light-status.service';
import { LightTuyaService } from './light-tuya.service';
import { isNetworkAvailable } from './network.util';

const NO_NETWORK_LOG_INTERVAL_MS = 5 * 60 * 1000;

export interface LightCheck {
  status: boolean;
  checkedAt: Date;
}

/** What a poll ended with. */
export type PollOutcome = 'busy' | 'no-network' | 'unknown' | 'failed' | 'unchanged' | 'changed';

@Injectable()
export class LightCronService implements OnModuleInit, OnApplicationBootstrap {
  private lastNoNetworkLogAt = 0;
  private lastCheck: LightCheck | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly tuya: LightTuyaService,
    private readonly status: LightStatusService,
    private readonly schedule: LightScheduleService,
    private readonly logger: LoggerService,
    private readonly notifyAdmin: NotifyAdminService,
  ) {}

  onModuleInit(): void {
    const timeZone = this.config.get<string>('TIMEZONE') || 'Europe/Kyiv';
    const interval = this.getPollIntervalMinutes();
    cron.schedule(`*/${interval} * * * *`, () => this.pollDeviceStatus(), { timezone: timeZone });
    this.logger.log(`Light status cron registered (every ${interval} minutes)`);
  }

  onApplicationBootstrap(): void {
    void this.pollDeviceStatus();
  }

  getPollIntervalMinutes(): number {
    return this.config.get<number>('TUYA_POLL_INTERVAL_MINUTES', 3);
  }

  /** The last successful Tuya answer; null until the first one arrives. */
  getLastCheck(): LightCheck | null {
    return this.lastCheck;
  }

  async pollDeviceStatus(): Promise<PollOutcome> {
    if (this.running) {
      this.logger.warn('[CRON] Previous check still running, skipping');
      return 'busy';
    }
    this.running = true;

    try {
      if (!(await isNetworkAvailable())) {
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
      this.lastCheck = { status: isOnline, checkedAt: new Date() };

      const lastHistoryEntry = await this.status.getLastHistoryEntry();
      if (lastHistoryEntry?.status === isOnline) {
        return 'unchanged';
      }

      this.logger.log(`[CRON] Status changed: ${lastHistoryEntry?.status ?? 'none'} -> ${isOnline}`);
      const scheduleLine = await this.describeScheduleSafely(isOnline);
      await this.status.applyStatusChange(deviceId, isOnline, lastHistoryEntry?.timestamp ?? null, scheduleLine);
      return 'changed';
    } catch (err) {
      this.logger.error('[CRON] Error in pollDeviceStatus', err);
      this.notifyAdmin.send(`🚨 Light cron error: ${err instanceof Error ? err.message : String(err)}`);
      return 'failed';
    } finally {
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
