import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { LightHandler } from './light.handler';
import { LightCronService } from './light-cron.service';
import { LightStatisticsService } from './light-statistics.service';
import { LightStatusService } from './light-status.service';
import { LightTuyaService } from './light-tuya.service';
import { LightHistory, LightHistorySchema } from './schemas/light-history.schema';
import { LightSubscription, LightSubscriptionSchema } from './schemas/light-subscription.schema';

@Module({
  imports: [
    MongooseModule.forFeatureAsync([
      {
        name: LightSubscription.name,
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => {
          const schema = LightSubscriptionSchema;
          schema.set('collection', config.get<string>('DB_SUBSCRIPTIONS_COLLECTION'));
          return schema;
        },
        inject: [ConfigService],
      },
      {
        name: LightHistory.name,
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => {
          const schema = LightHistorySchema;
          schema.set('collection', config.get<string>('DB_HISTORY_COLLECTION'));
          return schema;
        },
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [LightTuyaService, LightStatusService, LightStatisticsService, LightCronService, LightHandler],
})
export class LightModule {}
