import { getValue } from 'node-global-storage';
import { ILightRecord } from '../interfaces';
import onLightStatusChange from './onLightStatusChange';
import { localDbName, logger, socketId, sendErrorToAdmin } from '../utils';
import { getDeviceStatus } from '../utils/tuyaClient';
import LightHistory from '../schemas/lightHistory.schema';

const checkTuyaStatus = async (): Promise<void> => {
  try {
    logger.log('[CRON] Starting light status check...');
    const lightRecords: ILightRecord[] = getValue(localDbName);

    // Always use SOCKET_ID from .env
    if (!socketId) {
      logger.error('[CRON] SOCKET_ID is not configured in .env');
      await sendErrorToAdmin(new Error('SOCKET_ID is not configured'), {
        location: 'checkTuyaStatus (CRON)',
        additionalInfo: 'SOCKET_ID missing in .env',
      });
      return;
    }

    logger.log(`[CRON] Checking device ${socketId}...`);
    // Get status for the socket device
    const deviceStatus = await getDeviceStatus(socketId);
    logger.log(`[CRON] Device status: ${deviceStatus ? 'ON' : 'OFF'}`);

    // Get last history entry to compare with current status
    const lastHistoryEntry = await LightHistory.findOne().sort({ timestamp: -1 });
    const lastStatus = lastHistoryEntry ? lastHistoryEntry.status : null;

    logger.log(`[CRON] Last history status: ${lastStatus === null ? 'NONE' : lastStatus ? 'ON' : 'OFF'}`);

    // If status hasn't changed compared to last history entry, skip
    if (lastStatus === deviceStatus) {
      logger.log(`[CRON] Status unchanged (${deviceStatus ? 'ON' : 'OFF'}), skipping`);
      return;
    }

    // Status changed - update all records and notify users
    // Since all records track the same device, we can process them in parallel
    const updatePromises = Object.values(lightRecords).map(async (record) => {
      record.status = Boolean(deviceStatus);
      return onLightStatusChange(record, true, lastHistoryEntry?.timestamp);
    });

    await Promise.all(updatePromises);

    logger.log(
      `[CRON] Device ${socketId} status changed: ${lastStatus === null ? 'NONE' : lastStatus ? 'ON' : 'OFF'} -> ${deviceStatus ? 'ON' : 'OFF'}`
    );
    logger.log('[CRON] Light status check completed');
  } catch (err) {
    logger.error('[CRON] Error in checkTuyaStatus', err);
    await sendErrorToAdmin(err, {
      location: 'checkTuyaStatus (CRON)',
      deviceId: socketId,
      additionalInfo: 'Error during cron status check',
    });
  }
};

export default checkTuyaStatus;
