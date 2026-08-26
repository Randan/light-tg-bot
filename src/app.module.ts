import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule, NotifyAdminModule } from '@randan/tg-logger';

import { HealthModule } from './common/health/health.module';
import { configValidationSchema } from './config/config.schema';
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
    HealthModule,
    TelegramModule,
  ],
})
export class AppModule {}
