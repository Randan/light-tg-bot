import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import { TuyaContext } from '@tuya/tuya-connector-nodejs';

/** Response from tuya.device.detail() - Get Device Information API /v1.0/iot-03/devices/{id} */
interface TuyaDeviceDetailResponse {
  success?: boolean;
  code?: number;
  msg?: string;
  result?: {
    online?: boolean;
    result?: { online?: boolean; [key: string]: unknown };
    [key: string]: unknown;
  };
}

/** Do not notify the admin about the same ongoing API failure more than once per hour. */
const API_ERROR_NOTIFY_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class LightTuyaService {
  private lastApiErrorNotifiedAt = 0;
  private client: TuyaContext | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly notifyAdmin: NotifyAdminService,
  ) {}

  /**
   * Whether the device is online (= the power is on).
   * Returns null when the answer is UNKNOWN — the Tuya API call failed or
   * reported an error. An API failure must never be presented as "power off".
   */
  async getDeviceStatus(deviceId: string): Promise<boolean | null> {
    try {
      const deviceInfo = (await this.getClient().device.detail({
        device_id: deviceId,
      })) as unknown as TuyaDeviceDetailResponse;

      if (deviceInfo.success === false) {
        // e.g. code 28841002 "IoT Core service subscription has expired"
        const detail = `code=${deviceInfo.code ?? '?'} msg=${deviceInfo.msg ?? '?'}`;
        this.logger.error(`[TUYA API] Request rejected for ${deviceId}: ${detail}`);
        this.notifyApiError(`🚨 Tuya API rejected the request (${deviceId}): ${detail}`);
        return null;
      }

      const online = deviceInfo.result?.online === true || deviceInfo.result?.result?.online === true;
      this.logger.log(`[TUYA API] Device ${deviceId} is ${online ? 'online = light is ON' : 'offline = no light'}`);
      return online;
    } catch (error) {
      this.logger.error(`Error fetching device status for ${deviceId}:`, error);
      const err = error instanceof Error ? error : new Error(String(error));
      this.notifyApiError(`🚨 Tuya API error (${deviceId}): ${err.message}`);
      return null;
    }
  }

  /**
   * One client for the app lifetime: it keeps the access token in memory and
   * refreshes it on expiry. A new client per request fetched a fresh token every
   * time, doubling the API calls counted against the monthly quota.
   */
  private getClient(): TuyaContext {
    if (!this.client) {
      const accessKey = this.config.get<string>('TUYA_ACCESS_KEY');
      const secretKey = this.config.get<string>('TUYA_SECRET_KEY');
      const baseUrl = this.config.get<string>('TUYA_BASE_URL');
      if (!accessKey || !secretKey || !baseUrl) {
        throw new Error('Tuya config missing');
      }
      this.client = new TuyaContext({ accessKey, secretKey, baseUrl });
    }
    return this.client;
  }

  private notifyApiError(message: string): void {
    const now = Date.now();
    if (now - this.lastApiErrorNotifiedAt < API_ERROR_NOTIFY_INTERVAL_MS) {
      return;
    }
    this.lastApiErrorNotifiedAt = now;
    this.notifyAdmin.send(message);
  }
}
