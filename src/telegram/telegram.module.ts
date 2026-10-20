import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BotKitModule } from '@randan/tg-bot-kit';
import { TelegrafModule } from 'nestjs-telegraf';

import { LightModule } from '../light/light.module';

@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('BOT_TOKEN');
        if (!token) {
          throw new Error('BOT_TOKEN is required');
        }
        // BotKitModule for the admin /diag command
        return { token, include: [LightModule, BotKitModule] };
      },
      inject: [ConfigService],
    }),
    LightModule,
  ],
})
export class TelegramModule {}
