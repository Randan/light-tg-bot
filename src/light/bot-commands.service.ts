import type { OnApplicationBootstrap } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { LoggerService } from '@randan/tg-logger';
import { InjectBot } from 'nestjs-telegraf';
import type { Telegraf } from 'telegraf';

/** The public commands, in menu order. Admin-only commands stay unlisted. */
export const BOT_COMMANDS = [
  { command: 'status', description: 'Чи є світло зараз' },
  { command: 'schedule', description: 'Графік відключень ДТЕК на сьогодні й завтра' },
  { command: 'stats', description: 'Статистика відключень' },
  { command: 'start', description: 'Підписатися на сповіщення про світло' },
  { command: 'stop', description: 'Відписатися від сповіщень' },
  { command: 'help', description: 'Допомога' },
];

/**
 * Scopes Telegram picks a menu from, most specific first: a menu set by hand in
 * BotFather for private or group chats would shadow the default one, so the
 * same list is written to all of them.
 */
const SCOPES = [{ type: 'default' }, { type: 'all_private_chats' }, { type: 'all_group_chats' }] as const;

/** Registers the command menu on startup, so it always matches the code. */
@Injectable()
export class BotCommandsService implements OnApplicationBootstrap {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly logger: LoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      for (const scope of SCOPES) {
        await this.bot.telegram.setMyCommands(BOT_COMMANDS, { scope });
      }
      this.logger.log('Telegram command menu registered');
    } catch (err) {
      this.logger.error('Failed to register the Telegram command menu', err);
    }
  }
}
