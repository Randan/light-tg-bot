import { Module } from '@nestjs/common';

import { LightModule } from '../../light/light.module';
import { HealthController } from './health.controller';

@Module({
  imports: [LightModule],
  controllers: [HealthController],
})
export class HealthModule {}
