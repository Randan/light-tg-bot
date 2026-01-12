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
    logger.log(`[TUYA API] Making FRESH request to device ${deviceId}...`);
    // Force fresh request by creating new context each time (no caching)
    const freshTuya = new TuyaContext({
      accessKey: tuyaAccessKey,
      secretKey: tuyaSecretKey,
      baseUrl: tuyaBaseUrl,
    });

    const response = (await freshTuya.request({
      method: 'GET',
      path: `/v1.0/iot-03/devices/${deviceId}/status`,
    })) as TuyaResponse;

    logger.log(`[TUYA API] Response received: success=${response.success}, hasResult=${!!response.result}`);
    if (response.result) {
      logger.log(`[TUYA API] Response data: ${JSON.stringify(response.result)}`);
    }

    // If request is successful and has result - device is online
    if (response.success && response.result) {
      // Check real power consumption (cur_power) - this indicates if there's electricity in the socket
      // cur_power > 0 = there's electricity in the socket = light is ON
      // cur_power = 0 = no electricity in the socket = light is OFF
      // Note: switch_1 is for the device (e.g., kettle) plugged into the socket, not the socket itself
      const powerItem = response.result.find((item: TuyaStatusItem) => item.code === 'cur_power');

      if (powerItem !== undefined) {
        // Convert to number, handle string "0" or number 0
        const powerValue = typeof powerItem.value === 'number' ? powerItem.value : Number(powerItem.value) || 0;

        logger.log(`[TUYA API] Found cur_power: ${powerValue}W (type: ${typeof powerItem.value})`);

        // If power > 0, there's electricity in the socket = light is ON
        if (powerValue > 0) {
          logger.log(`[TUYA API] Power > 0, electricity is present = light is ON`);
          return true;
        }

        // If power = 0, no electricity in the socket = light is OFF
        logger.log(`[TUYA API] Power = 0, no electricity = light is OFF`);
        return false;
      }

      // If cur_power not found, log warning and return false
      logger.warn(
        `[TUYA API] cur_power not found in response for device ${deviceId}. Available codes: ${response.result
          .map((item: TuyaStatusItem) => item.code)
          .join(', ')}`,
      );
      return false;
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
