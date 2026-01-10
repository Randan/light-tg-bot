import bot from '../bot';
import { logger, sendErrorToAdmin } from '../utils';
import LightHistory from '../schemas/lightHistory.schema';

const getStatistics = async (id: number, period: string): Promise<void> => {
  try {
    if (!id) {
      logger.error('User id is required');
      return;
    }

    const now = new Date();
    let startDate: Date;
    let periodName: string;

    switch (period) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        periodName = 'день';
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        periodName = 'тиждень';
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        periodName = 'місяць';
        break;
      case 'halfyear':
        startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        periodName = 'півроку';
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        periodName = 'рік';
        break;
      case 'all':
        startDate = new Date(0);
        periodName = 'весь час';
        break;
      default:
        bot.sendMessage(id, 'Невідомий період');
        return;
    }

    // Count records where status is true (light turned ON, meaning it was off before)
    // Using countDocuments with index for better performance
    const count = await LightHistory.countDocuments({
      timestamp: { $gte: startDate },
      status: true,
    }).lean(); // Use lean() for better performance (returns plain JS objects)

    const message = `Кількість виключень за ${periodName}: ${count}`;
    bot.sendMessage(id, message);
  } catch (err) {
    logger.error('Failed to get statistics', err);
    bot.sendMessage(id, 'Помилка при отриманні статистики');
    await sendErrorToAdmin(err, {
      location: 'getStatistics',
      userId: id,
      additionalInfo: `Failed to get statistics for period: ${period}`,
    });
  }
};

export default getStatistics;
