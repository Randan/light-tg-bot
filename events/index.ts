import type { Message } from 'node-telegram-bot-api';
import bot from '../bot';
import { checkStatus, getStatistics, help } from '../controllers';

const events: Record<string, RegExp> = {
  help: /\/help/,
  status: /\/status/,
  stats: /\/stats/,
};

bot.onText(events.help, (msg: Message): void => help(msg));

bot.onText(events.status, async (msg: Message): Promise<void> => checkStatus(msg.from?.id || 0));

bot.onText(events.stats, async (msg: Message): Promise<void> => getStatistics(msg.from?.id || 0));
