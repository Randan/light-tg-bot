import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { LoggerService } from '@randan/tg-logger';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);

  await app.listen(port);

  const logger = app.get(LoggerService);
  logger.log(`Light Bot is running on port ${port}`);
}

bootstrap().catch(err => {
  console.error(err);
  process.exit(1);
});
