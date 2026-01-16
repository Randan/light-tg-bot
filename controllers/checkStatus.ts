import bot from '../bot';
import LightHistory from '../schemas/lightHistory.schema';
import { formatTime, logger, sendErrorToAdmin, socketId } from '../utils';
import { getDeviceStatus } from '../utils/tuyaClient';

const checkStatus = async (id: number): Promise<void> => {
  try {
    logger.log(`[USER REQUEST] User ${id} requested status check`);
    if (!id) {
      logger.error('[USER REQUEST] User id is required');
      return;
    }

    if (!socketId) {
      bot.sendMessage(id, 'Помилка: SOCKET_ID не налаштовано');
      logger.error('[USER REQUEST] SOCKET_ID is not configured in .env');
      await sendErrorToAdmin(new Error('SOCKET_ID is not configured'), {
        location: 'checkStatus',
        userId: id,
      });
      return;
    }

    bot.sendMessage(id, 'Перевіряю статус...');

    logger.log(`[USER REQUEST] Checking device ${socketId}...`);
    const deviceStatus = await getDeviceStatus(socketId);
    logger.log(`[USER REQUEST] Device status: ${deviceStatus ? 'ON' : 'OFF'}`);

    const lastHistoryEntry = await LightHistory.findOne().sort({ timestamp: -1 }).lean();
    const canShowDuration = lastHistoryEntry && lastHistoryEntry.status === deviceStatus;
    const durationText = canShowDuration
      ? ` (${formatTime(new Date().getTime() - new Date(lastHistoryEntry.timestamp).getTime())})`
      : '';

    const message = deviceStatus ? `🟢 Світло є${durationText}` : `🔴 Світла немає${durationText}`;

    bot.sendMessage(id, message);
    logger.log(`[USER REQUEST] Status sent to user ${id}`);
  } catch (err) {
    logger.error('[USER REQUEST] Failed to check status', err);
    bot.sendMessage(id, 'Помилка при перевірці статусу');
    await sendErrorToAdmin(err, {
      location: 'checkStatus',
      userId: id,
      deviceId: socketId,
      additionalInfo: 'Failed to check device status',
    });
  }
};

export default checkStatus;
