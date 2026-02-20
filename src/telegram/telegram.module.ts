import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { LightModule } from '../light/light.module';

@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('BOT_TOKEN');
        if (!token) throw new Error('BOT_TOKEN is required');
        return { token, include: [LightModule] };
      },
      inject: [ConfigService],
    }),
    LightModule,
  ],
})
export class TelegramModule {}
