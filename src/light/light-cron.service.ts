import type { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import type { Model } from 'mongoose';
import * as cron from 'node-cron';

import { LightCacheService } from './light-cache.service';
import { LightStatusService } from './light-status.service';
import { LightTuyaService } from './light-tuya.service';
import { isNetworkAvailable } from './network.util';
import { LightHistoryDoc } from './schemas/light-history.schema';

const NO_NETWORK_LOG_INTERVAL_MS = 5 * 60 * 1000;
let lastNoNetworkLogAt = 0;

@Injectable()
export class LightCronService implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly tuya: LightTuyaService,
    private readonly cache: LightCacheService,
    private readonly status: LightStatusService,
    @InjectModel(LightHistoryDoc.name)
    private readonly lightHistoryModel: Model<LightHistoryDoc>,
    private readonly logger: LoggerService,
    private readonly notifyAdmin: NotifyAdminService,
  ) {}

  onModuleInit(): void {
    const timeZone = this.config.get<string>('TIMEZONE') || 'Europe/Kyiv';
    cron.schedule('*/5 * * * *', () => this.checkTuyaStatus(), { timezone: timeZone });
    this.logger.log('Light status cron registered (every 5 minutes)');
  }

  async checkTuyaStatus(): Promise<void> {
    try {
      if (!(await isNetworkAvailable())) {
        const now = Date.now();
        if (now - lastNoNetworkLogAt >= NO_NETWORK_LOG_INTERVAL_MS) {
          this.logger.warn('[CRON] Skipping status check: no network');
          lastNoNetworkLogAt = now;
        }
        return;
      }

      const deviceId = this.config.get<string>('TUYA_DEVICE_ID');
      if (!deviceId) {
        this.logger.error('[CRON] TUYA_DEVICE_ID is not configured');
        this.notifyAdmin.send('🚨 TUYA_DEVICE_ID is not configured', {
          parse_mode: 'Markdown',
        });
        return;
      }

      this.logger.log('[CRON] Starting light status check...');
      const lightRecords = this.cache.getRecords();
      const deviceStatus = await this.tuya.getDeviceStatus(deviceId);
      this.logger.log(`[CRON] Device status: ${deviceStatus ? 'ON' : 'OFF'}`);

      const lastHistoryEntry = await this.lightHistoryModel.findOne().sort({ timestamp: -1 }).lean().exec();
      const lastStatus = lastHistoryEntry ? lastHistoryEntry.status : null;

      if (lastStatus === deviceStatus) {
        this.logger.log('[CRON] Status unchanged, skipping');
        return;
      }

      for (const record of lightRecords) {
        if (record.deviceId !== deviceId) {
          continue;
        }
        record.status = Boolean(deviceStatus);
        await this.status.onLightStatusChange(record, true, lastHistoryEntry?.timestamp);
      }

      this.logger.log('[CRON] Light status check completed');
    } catch (err) {
      this.logger.error('[CRON] Error in checkTuyaStatus', err);
      this.notifyAdmin.send(`🚨 Light cron error: ${err instanceof Error ? err.message : String(err)}`, {
        parse_mode: 'Markdown',
      });
    }
  }
}
