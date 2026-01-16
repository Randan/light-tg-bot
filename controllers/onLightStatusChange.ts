import bot from '../bot';
import { formatTime, localDbName, logger, sendErrorToAdmin } from '../utils';
import { LightRecords } from '../schemas';
import LightHistory from '../schemas/lightHistory.schema';
import type { ILightRecord } from '../interfaces';
import { setValue } from 'node-global-storage';

const updateLightRecords = async (): Promise<void> => {
  try {
    const response: ILightRecord[] = await LightRecords.find({
      userIds: { $not: { $size: 0 } },
    });

    setValue(localDbName, response);
  } catch (err) {
    logger.error('Failed to update light records', err);
    await sendErrorToAdmin(err, {
      location: 'updateLightRecords',
      additionalInfo: 'Failed to update light records in memory',
    });
  }
};

const onLightStatusChange = async (
  record: ILightRecord,
  isAutomatic = false,
  lastHistoryTimestamp?: Date,
): Promise<void> => {
  const { status, userIds, deviceId } = record;

  let message: string;
  let timeFormatted = '';

  if (isAutomatic && lastHistoryTimestamp) {
    // Calculate time difference from last history entry
    const delta = new Date().getTime() - new Date(lastHistoryTimestamp).getTime();
    timeFormatted = formatTime(delta);

    // Automatic check from cron
    message = status
      ? `🟢 Світло увімкнене (світла не було ${timeFormatted})`
      : `🔴 Світло вимкнене (світло було ${timeFormatted})`;
  } else {
    // Manual check from user
    message = status ? '🟢 Світло є' : '🔴 Світла нема';
  }

  try {
    // Send messages to all users
    await Promise.all(
      userIds.map((id: number) =>
        bot.sendMessage(id, message).catch(err => {
          logger.error(`Failed to send message to user ${id}`, err);
          return sendErrorToAdmin(err, {
            location: 'onLightStatusChange - sendMessage',
            userId: id,
            deviceId,
          });
        }),
      ),
    );

    // Update database and history in parallel
    const dbUpdatePromise = LightRecords.updateOne({ deviceId }, { status });
    const historyPromise = isAutomatic
      ? LightHistory.create({
          timestamp: new Date(),
          status,
        })
      : Promise.resolve(null);

    await Promise.all([dbUpdatePromise, historyPromise]);

    if (isAutomatic) {
      logger.log(`[HISTORY] Added new entry: light ${status ? 'turned ON' : 'turned OFF'}`);
    }

    // Update local cache asynchronously (don't wait for it)
    updateLightRecords().catch(err => {
      logger.error('Failed to update light records cache', err);
    });
  } catch (err) {
    logger.error('Failed to update light status', err);
    await sendErrorToAdmin(err, {
      location: 'onLightStatusChange',
      deviceId,
      additionalInfo: `Failed to update status to ${status}`,
    });
  }
};

export default onLightStatusChange;
