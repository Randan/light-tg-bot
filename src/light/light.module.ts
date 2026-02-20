import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { LightRecord, LightRecordSchema } from './schemas/light-record.schema';
import {
  LightHistoryDoc,
  LightHistorySchema,
} from './schemas/light-history.schema';
import { LightTuyaService } from './light-tuya.service';
import { LightCacheService } from './light-cache.service';
import { LightStatusService } from './light-status.service';
import { LightStatisticsService } from './light-statistics.service';
import { LightCronService } from './light-cron.service';
import { LightHandler } from './light.handler';

@Module({
  imports: [
    MongooseModule.forFeatureAsync([
      {
        name: LightRecord.name,
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => {
          const schema = LightRecordSchema;
          schema.set(
            'collection',
            config.get<string>('DB_LIGHT_COLLECTION'),
          );
          return schema;
        },
        inject: [ConfigService],
      },
      {
        name: LightHistoryDoc.name,
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => {
          const schema = LightHistorySchema;
          schema.set(
            'collection',
            config.get<string>('DB_LIGHT_HISTORY_COLLECTION'),
          );
          return schema;
        },
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [
    LightTuyaService,
    LightCacheService,
    LightStatusService,
    LightStatisticsService,
    LightCronService,
    LightHandler,
  ],
})
export class LightModule {}
