import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';

@Injectable()
export class NotifyAdminService {
  constructor(
    @InjectBot() private readonly bot: Telegraf,
    private readonly config: ConfigService,
  ) {}

  send(message: string, options?: { parse_mode?: 'Markdown' | 'HTML' }): void {
    const adminId = this.config.get<string>('ADMIN_TELEGRAM_ID');
    if (!adminId) {
      return;
    }
    this.bot.telegram
      .sendMessage(adminId, message, options || {})
      .catch((err) => {
        console.error('Failed to send admin notification:', err);
      });
  }
}
