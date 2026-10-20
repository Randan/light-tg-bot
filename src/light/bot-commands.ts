import type { BotCommand } from '@randan/tg-bot-kit';

/** The public commands, in menu order; the kit writes them to Telegram on startup. Admin commands stay unlisted. */
export const BOT_COMMANDS: BotCommand[] = [
  { command: 'status', description: 'Чи є світло зараз' },
  { command: 'schedule', description: 'Графік відключень ДТЕК на сьогодні й завтра' },
  { command: 'stats', description: 'Статистика відключень' },
  { command: 'start', description: 'Підписатися на сповіщення про світло' },
  { command: 'stop', description: 'Відписатися від сповіщень' },
  { command: 'help', description: 'Допомога' },
];
