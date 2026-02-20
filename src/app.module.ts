import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { configValidationSchema } from './config/config.schema';
import { LoggerModule } from './common/logger/logger.module';
import { NotifyAdminModule } from './common/notify-admin/notify-admin.module';
import { HealthModule } from './common/health/health.module';
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
