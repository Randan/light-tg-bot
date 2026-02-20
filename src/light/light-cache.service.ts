import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { setValue, getValue } from 'node-global-storage';
import { LightRecord } from './schemas/light-record.schema';
import { LoggerService } from '../common/logger/logger.service';

export interface LightRecordData {
  status: boolean;
  userIds: number[];
  deviceId: string;
}

@Injectable()
export class LightCacheService implements OnModuleInit {
  constructor(
    @InjectModel(LightRecord.name) private readonly lightRecordModel: Model<LightRecord>,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    this.loadFromDb().catch((err) => {
      this.logger.error('Failed to load light records on init', err);
    });
  }

  async loadFromDb(): Promise<void> {
    const records = await this.lightRecordModel
      .find({ userIds: { $not: { $size: 0 } } })
      .lean()
      .exec();
    const key = this.config.get<string>('LOCAL_DB_NAME');
    if (key) {
      setValue(key, records as LightRecordData[]);
      this.logger.log(`Loaded ${records.length} light records into memory`);
    }
  }

  getRecords(): LightRecordData[] {
    const key = this.config.get<string>('LOCAL_DB_NAME');
    if (!key) return [];
    return (getValue(key) as LightRecordData[]) || [];
  }

  async updateCache(): Promise<void> {
    await this.loadFromDb();
  }
}
