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
    let periodNameGenitive: string;

    switch (period) {
      case 'day': {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        periodNameGenitive = 'дня';
        break;
      }
      case 'week': {
        startDate = new Date(now);
        const dayOfWeek = (startDate.getDay() + 6) % 7; // Monday=0
        startDate.setDate(startDate.getDate() - dayOfWeek);
        startDate.setHours(0, 0, 0, 0);
        periodNameGenitive = 'тижня';
        break;
      }
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        periodNameGenitive = 'місяця';
        break;
      case 'halfyear': {
        const startMonth = now.getMonth() < 6 ? 0 : 6;
        startDate = new Date(now.getFullYear(), startMonth, 1);
        periodNameGenitive = 'півроку';
        break;
      }
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        periodNameGenitive = 'року';
        break;
      case 'all':
        startDate = new Date(0);
        periodNameGenitive = 'весь час';
        break;
      default:
        bot.sendMessage(id, 'Невідомий період');
        return;
    }

    // Count records where status is false (light turned OFF)
    // Using countDocuments with index for better performance
    const count = await LightHistory.countDocuments({
      timestamp: { $gte: startDate },
      status: false,
    });

    const message =
      periodNameGenitive === 'весь час'
        ? `Кількість відключень за весь час: ${count}`
        : `Кількість відключень з початку ${periodNameGenitive}: ${count}`;
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
