import { TuyaContext } from '@tuya/tuya-connector-nodejs';
import { tuyaAccessKey, tuyaBaseUrl, tuyaSecretKey } from './envVars';
import { sendErrorToAdmin } from './errorHandler';
import { logger } from './logger';

interface TuyaDeviceInfo {
  success: boolean;
  result?: {
    online: boolean;
    active_time?: number;
    [key: string]: unknown;
  };
}

const tuya = new TuyaContext({
  accessKey: tuyaAccessKey,
  secretKey: tuyaSecretKey,
  baseUrl: tuyaBaseUrl,
});

export const getDeviceStatus = async (deviceId: string): Promise<boolean> => {
  try {
    logger.log(`[TUYA API] Checking if device ${deviceId} is online...`);
    // Force fresh request by creating new context each time (no caching)
    const freshTuya = new TuyaContext({
      accessKey: tuyaAccessKey,
      secretKey: tuyaSecretKey,
      baseUrl: tuyaBaseUrl,
    });

    // Check if device is online using device info endpoint
    const deviceInfo = (await freshTuya.request({
      method: 'GET',
      path: `/v1.0/devices/${deviceId}`,
    })) as TuyaDeviceInfo;

    logger.log(`[TUYA API] Device info received: success=${deviceInfo.success}, online=${deviceInfo.result?.online}`);

    // If device is online, light is ON
    // If device is offline, light is OFF
    if (deviceInfo.success && deviceInfo.result?.online) {
      logger.log(`[TUYA API] Device ${deviceId} is online = light is ON`);
      return true;
    }

    logger.log(`[TUYA API] Device ${deviceId} is offline = no light`);
    return false;
  } catch (error) {
    // Error fetching status - device is offline, no light
    logger.error(`Error fetching device online status for ${deviceId}:`, error);
    await sendErrorToAdmin(error, {
      location: 'getDeviceStatus (Tuya API)',
      deviceId,
      additionalInfo: 'Tuya API request failed',
    });
    return false;
  }
};

export default tuya;
