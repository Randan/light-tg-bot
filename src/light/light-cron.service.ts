import type { OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import * as cron from 'node-cron';

import { LightStatusService } from './light-status.service';
import { LightTuyaService } from './light-tuya.service';
import { isNetworkAvailable } from './network.util';

const NO_NETWORK_LOG_INTERVAL_MS = 5 * 60 * 1000;

export interface LightCheck {
  status: boolean;
  checkedAt: Date;
}

@Injectable()
export class LightCronService implements OnModuleInit, OnApplicationBootstrap {
  private lastNoNetworkLogAt = 0;
  private lastCheck: LightCheck | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly tuya: LightTuyaService,
    private readonly status: LightStatusService,
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

  async pollDeviceStatus(): Promise<void> {
    if (this.running) {
      this.logger.warn('[CRON] Previous check still running, skipping');
      return;
    }
    this.running = true;

    try {
      if (!(await isNetworkAvailable())) {
        const now = Date.now();
        if (now - this.lastNoNetworkLogAt >= NO_NETWORK_LOG_INTERVAL_MS) {
          this.logger.warn('[CRON] Skipping status check: no network');
          this.lastNoNetworkLogAt = now;
        }
        return;
      }

      const deviceId = this.config.get<string>('TUYA_DEVICE_ID')!;
      const isOnline = await this.tuya.isDeviceOnline(deviceId);
      if (isOnline === null) {
        this.logger.error('[CRON] Device status is UNKNOWN (Tuya API failure), skipping this check');
        return;
      }
      this.lastCheck = { status: isOnline, checkedAt: new Date() };

      const lastHistoryEntry = await this.status.getLastHistoryEntry();
      if (lastHistoryEntry?.status === isOnline) {
        return;
      }

      this.logger.log(`[CRON] Status changed: ${lastHistoryEntry?.status ?? 'none'} -> ${isOnline}`);
      await this.status.applyStatusChange(deviceId, isOnline, lastHistoryEntry?.timestamp ?? null);
    } catch (err) {
      this.logger.error('[CRON] Error in pollDeviceStatus', err);
      this.notifyAdmin.send(`🚨 Light cron error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
