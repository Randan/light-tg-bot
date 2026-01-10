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
    
    const response = await freshTuya.request({
      method: 'GET',
      path: `/v1.0/iot-03/devices/${deviceId}/status`,
    }) as TuyaResponse;

    logger.log(`[TUYA API] Response received: success=${response.success}, hasResult=${!!response.result}`);
    if (response.result) {
      logger.log(`[TUYA API] Response data: ${JSON.stringify(response.result)}`);
    }

    // If request is successful and has result - device is online
    if (response.success && response.result) {
      // Check real power consumption first - this is the most accurate indicator
      const powerItem = response.result.find(
        (item: TuyaStatusItem) => item.code === 'cur_power'
      );
      
      if (powerItem) {
        const powerValue = Number(powerItem.value) || 0;
        const isOn = powerValue > 0;
        logger.log(`[TUYA API] Power status: cur_power = ${powerValue}W (${isOn ? 'ON' : 'OFF'})`);
        
        // If power > 0, device is definitely on
        if (isOn) {
          return true;
        }
        
        // If power = 0, check switch_1 as fallback (but power is more reliable)
        const switchItem = response.result.find(
          (item: TuyaStatusItem) =>
            item.code === 'switch_1' || item.code === 'switch'
        );
        
        if (switchItem) {
          const switchValue = Boolean(switchItem.value);
          logger.log(`[TUYA API] Switch status: ${switchItem.code} = ${switchItem.value}, but power = 0, so device is OFF`);
          // Power = 0 means device is off, regardless of switch status
          return false;
        }
        
        // Power = 0 and no switch found = off
        return false;
      }
      
      // If no power data, fallback to switch_1
      const statusItem = response.result.find(
        (item: TuyaStatusItem) =>
          item.code === 'switch_1' || item.code === 'switch'
      );

      if (statusItem) {
        const switchValue = Boolean(statusItem.value);
        logger.log(`[TUYA API] Switch status found (no power data): ${statusItem.code} = ${statusItem.value} (${switchValue ? 'ON' : 'OFF'})`);
        return switchValue;
      }

      // If no switch found, log warning and return false (no switch = no light)
      logger.warn(`[TUYA API] No switch or power status found in response for device ${deviceId}. Available codes: ${response.result.map((item: TuyaStatusItem) => item.code).join(', ')}`);
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

