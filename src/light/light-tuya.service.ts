import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService, NotifyAdminService } from '@randan/tg-logger';
import { TuyaContext } from '@tuya/tuya-connector-nodejs';

import { FailureAlert } from './failure-alert.util';

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

/**
 * The connector uses axios without a timeout: a request Tuya never answers
 * would hang the poll forever and stop the power tracking until a restart.
 */
const REQUEST_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class LightTuyaService {
  private client: TuyaContext | null = null;
  private lastError: string | null = null;
  private readonly alert: FailureAlert;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    notifyAdmin: NotifyAdminService,
  ) {
    this.alert = new FailureAlert(message => notifyAdmin.send(message), '✅ Tuya API відповідає знову');
  }

  /**
   * Whether the device is online (= the power is on).
   * Returns null when the answer is UNKNOWN — the Tuya API call failed or
   * reported an error. An API failure must never be presented as "power off".
   */
  async isDeviceOnline(deviceId: string): Promise<boolean | null> {
    try {
      const deviceInfo = (await withTimeout(
        this.getClient().device.detail({ device_id: deviceId }),
        REQUEST_TIMEOUT_MS,
      )) as unknown as TuyaDeviceDetailResponse;

      if (deviceInfo.success === false) {
        // e.g. code 28841002 "IoT Core service subscription has expired"
        const detail = `code=${deviceInfo.code ?? '?'} msg=${deviceInfo.msg ?? '?'}`;
        this.logger.error(`[TUYA API] Request rejected for ${deviceId}: ${detail}`);
        this.lastError = detail;
        this.alert.fail(`🚨 Tuya API rejected the request (${deviceId}): ${detail}`);
        return null;
      }

      // A missing flag is an unknown answer, not "offline"
      const online = deviceInfo.result?.online ?? deviceInfo.result?.result?.online;
      if (typeof online !== 'boolean') {
        const detail = 'no online flag in the response';
        this.logger.error(`[TUYA API] ${detail} for ${deviceId}: ${JSON.stringify(deviceInfo).slice(0, 500)}`);
        this.lastError = detail;
        this.alert.fail(`🚨 Tuya API answered without the device state (${deviceId})`);
        return null;
      }

      this.logger.log(`[TUYA API] Device ${deviceId} is ${online ? 'online = light is ON' : 'offline = no light'}`);
      this.lastError = null;
      this.alert.ok();
      return online;
    } catch (error) {
      this.logger.error(`Error fetching device status for ${deviceId}:`, error);
      const err = error instanceof Error ? error : new Error(String(error));
      this.lastError = err.message;
      this.alert.fail(`🚨 Tuya API error (${deviceId}): ${err.message}`);
      return null;
    }
  }

  /** Why the last Tuya call failed; null after a successful one. */
  getLastError(): string | null {
    return this.lastError;
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
}
