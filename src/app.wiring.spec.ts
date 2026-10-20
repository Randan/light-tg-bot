import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { BotKitModule, BotKitRegistry } from '@randan/tg-bot-kit';
import { LoggerModule, NotifyAdminModule } from '@randan/tg-logger';
import { getBotToken } from 'nestjs-telegraf';

import { configValidationSchema } from './config/config.schema';
import { BOT_COMMANDS } from './light/bot-commands';
import { LightHandler } from './light/light.handler';
import { LightModule } from './light/light.module';
import { LightCronService } from './light/light-cron.service';
import { LightScheduleService } from './light/light-schedule.service';
import { LightHistory } from './light/schemas/light-history.schema';
import { LightSubscription } from './light/schemas/light-subscription.schema';
import { OutageSchedule } from './light/schemas/outage-schedule.schema';

/** Stands in for TelegrafModule and the Mongo connection: global, like the real ones. */
@Global()
@Module({
  providers: [
    { provide: getBotToken(), useValue: { telegram: { setMyCommands: jest.fn(), sendMessage: jest.fn() } } },
    { provide: getConnectionToken(), useValue: {} },
  ],
  exports: [getBotToken(), getConnectionToken()],
})
class FakeInfrastructureModule {}

/**
 * The real module graph, without network or database: catches what unit tests
 * with hand-made fakes cannot, e.g. a provider Nest cannot resolve, which would
 * otherwise only show up as a crash on the Pi.
 */
describe('application wiring', () => {
  it('resolves every provider of the bot', async () => {
    const model = { db: { readyState: 1 } };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () =>
            configValidationSchema({
              BOT_TOKEN: 'token',
              DB_URL: 'mongodb://localhost/light-tg-bot',
              TUYA_ACCESS_KEY: 'a',
              TUYA_SECRET_KEY: 's',
              TUYA_DEVICE_ID: 'dev',
              TIMEZONE: 'Europe/Kyiv',
              YASNO_STREET: 'Тираспольська',
              YASNO_HOUSE: '54',
              LOG_LEVEL: 'silent',
            }),
        }),
        FakeInfrastructureModule,
        LoggerModule,
        NotifyAdminModule,
        BotKitModule.forRoot({ name: 'light-tg-bot', commands: BOT_COMMANDS }),
        LightModule,
      ],
    })
      .overrideProvider(getModelToken(LightSubscription.name))
      .useValue(model)
      .overrideProvider(getModelToken(LightHistory.name))
      .useValue(model)
      .overrideProvider(getModelToken(OutageSchedule.name))
      .useValue(model)
      .compile();

    expect(moduleRef.get(LightHandler)).toBeInstanceOf(LightHandler);
    expect(moduleRef.get(LightCronService)).toBeInstanceOf(LightCronService);
    expect(moduleRef.get(LightScheduleService).isConfigured()).toBe(true);
    expect(moduleRef.get(BotKitRegistry)).toBeInstanceOf(BotKitRegistry);
    await moduleRef.close();
  });
});
