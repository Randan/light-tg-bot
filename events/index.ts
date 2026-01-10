import { Message } from 'node-telegram-bot-api';
import bot from '../bot';
import { checkStatus, getStatistics, help } from '../controllers';

const events: Record<string, RegExp> = {
  help: /\/help/,
  status: /\/status/,
  statsDay: /\/stats_day/,
  statsWeek: /\/stats_week/,
  statsMonth: /\/stats_month/,
  statsHalfyear: /\/stats_halfyear/,
  statsYear: /\/stats_year/,
  statsAll: /\/stats_all/,
};

bot.onText(events.help, (msg: Message): void => help(msg));

bot.onText(
  events.status,
  async (msg: Message): Promise<void> => checkStatus(msg.from?.id || 0)
);

bot.onText(
  events.statsDay,
  async (msg: Message): Promise<void> => getStatistics(msg.from?.id || 0, 'day')
);

bot.onText(
  events.statsWeek,
  async (msg: Message): Promise<void> => getStatistics(msg.from?.id || 0, 'week')
);

bot.onText(
  events.statsMonth,
  async (msg: Message): Promise<void> => getStatistics(msg.from?.id || 0, 'month')
);

bot.onText(
  events.statsHalfyear,
  async (msg: Message): Promise<void> => getStatistics(msg.from?.id || 0, 'halfyear')
);

bot.onText(
  events.statsYear,
  async (msg: Message): Promise<void> => getStatistics(msg.from?.id || 0, 'year')
);

bot.onText(
  events.statsAll,
  async (msg: Message): Promise<void> => getStatistics(msg.from?.id || 0, 'all')
);
