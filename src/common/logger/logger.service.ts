import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LoggerService {
  private readonly isDev: boolean;

  constructor(private readonly config: ConfigService) {
    this.isDev = this.config.get<string>('NODE_ENV') === 'development';
  }

  log(...args: unknown[]): void {
    if (this.isDev) {
      console.log(...args);
    }
  }

  error(...args: unknown[]): void {
    console.error(...args);
  }

  warn(...args: unknown[]): void {
    console.warn(...args);
  }
}
