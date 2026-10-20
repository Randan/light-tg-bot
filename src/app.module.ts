import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BotKitModule } from '@randan/tg-bot-kit';
import { LoggerModule, NotifyAdminModule } from '@randan/tg-logger';

import { configValidationSchema } from './config/config.schema';
import { BOT_COMMANDS } from './light/bot-commands';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: configValidationSchema,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('DB_URL'),
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        // Keep retrying instead of exiting: a DB outage must not turn into a
        // container restart loop, and the bot must recover on its own.
        retryAttempts: Number.MAX_SAFE_INTEGER,
        retryDelay: 30000,
      }),
      inject: [ConfigService],
    }),
    LoggerModule,
    NotifyAdminModule,
    // GET /health, the admin /diag and the command menu
    BotKitModule.forRoot({ name: 'light-tg-bot', commands: BOT_COMMANDS }),
    TelegramModule,
  ],
})
export class AppModule {}
