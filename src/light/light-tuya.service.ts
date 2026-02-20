import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TuyaContext } from '@tuya/tuya-connector-nodejs';
import { LoggerService } from '../common/logger/logger.service';
import { NotifyAdminService } from '../common/notify-admin/notify-admin.service';

/** Response from tuya.device.detail() - Get Device Information API /v1.0/iot-03/devices/{id} */
interface TuyaDeviceDetailResponse {
  success?: boolean;
  result?: {
    online?: boolean;
    result?: { online?: boolean; [key: string]: unknown };
    [key: string]: unknown;
  };
}

@Injectable()
export class LightTuyaService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly notifyAdmin: NotifyAdminService,
  ) {}

  async getDeviceStatus(deviceId: string): Promise<boolean> {
    try {
      this.logger.log(`[TUYA API] Checking if device ${deviceId} is online...`);
      const accessKey = this.config.get<string>('TUYA_ACCESS_KEY');
      const secretKey = this.config.get<string>('TUYA_SECRET_KEY');
      const baseUrl = this.config.get<string>('TUYA_BASE_URL');
      if (!accessKey || !secretKey || !baseUrl) throw new Error('Tuya config missing');
      const tuya = new TuyaContext({ accessKey, secretKey, baseUrl });

      // Use library's device.detail() - path /v1.0/iot-03/devices/{id} (was wrong: /v1.0/devices/{id})
      const deviceInfo = (await tuya.device.detail({
        device_id: deviceId,
      })) as unknown as TuyaDeviceDetailResponse;

      const online =
        deviceInfo.result?.online === true ||
        deviceInfo.result?.result?.online === true;
      this.logger.log(
        `[TUYA API] Device info: success=${deviceInfo.success}, online=${online}`,
      );

      if (deviceInfo.success !== false && online) {
        this.logger.log(`[TUYA API] Device ${deviceId} is online = light is ON`);
        return true;
      }

      this.logger.log(`[TUYA API] Device ${deviceId} is offline = no light`);
      return false;
    } catch (error) {
      this.logger.error(`Error fetching device status for ${deviceId}:`, error);
      const err = error instanceof Error ? error : new Error(String(error));
      this.notifyAdmin.send(
        `🚨 Tuya API error (${deviceId}): ${err.message}`,
        { parse_mode: 'Markdown' },
      );
      return false;
    }
  }
}
