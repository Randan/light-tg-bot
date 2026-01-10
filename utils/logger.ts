import { env } from './envVars';

const isDev = env === 'dev';

export const logger = {
  log: (...args: unknown[]): void => {
    if (isDev) {
      console.log(...args);
    }
  },
  error: (...args: unknown[]): void => {
    // Always log errors, even in production
    console.error(...args);
  },
  warn: (...args: unknown[]): void => {
    // Always log warnings, even in production
    console.warn(...args);
  },
};
