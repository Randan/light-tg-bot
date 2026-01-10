import { TuyaContext } from '@tuya/tuya-connector-nodejs';
import { tuyaAccessKey, tuyaBaseUrl, tuyaSecretKey } from './envVars';
import { sendErrorToAdmin } from './errorHandler';
import { logger } from './logger';

interface TuyaStatusItem {
  code: string;
  value: boolean | string | number;
}

interface TuyaResponse {
  success: boolean;
  result?: TuyaStatusItem[];
}

const tuya = new TuyaContext({
  accessKey: tuyaAccessKey,
  secretKey: tuyaSecretKey,
  baseUrl: tuyaBaseUrl,
});

export const getDeviceStatus = async (deviceId: string): Promise<boolean> => {
  try {
    logger.log(`[TUYA API] Making request to device ${deviceId}...`);
    const response = await tuya.request({
      method: 'GET',
      path: `/v1.0/iot-03/devices/${deviceId}/status`,
    }) as TuyaResponse;

    logger.log(`[TUYA API] Response received: success=${response.success}, hasResult=${!!response.result}`);

    // If request is successful and has result - device is online
    if (response.success && response.result) {
      // Find the switch status (usually code 'switch_1' or 'switch')
      const statusItem = response.result.find(
        (item: TuyaStatusItem) =>
          item.code === 'switch_1' || item.code === 'switch'
      );

      if (statusItem) {
        // Device is online, return switch status
        return Boolean(statusItem.value);
      }

      // If no switch found, check if any status indicates device is on
      const hasOnStatus = response.result.some(
        (item: TuyaStatusItem) => Boolean(item.value) === true
      );
      // Device is online, return status
      return hasOnStatus;
    }

    // Request failed or no result - device is offline, no light
    logger.warn(`Device ${deviceId} appears to be offline or request failed`);
    return false;
  } catch (error) {
    // Error fetching status - device is offline, no light
    logger.error(`Error fetching device status for ${deviceId}:`, error);
    await sendErrorToAdmin(error, {
      location: 'getDeviceStatus (Tuya API)',
      deviceId,
      additionalInfo: 'Tuya API request failed',
    });
    return false;
  }
};

export default tuya;

