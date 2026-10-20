import type { RawEnv } from '@randan/tg-bot-kit';
import { buildMongoUri, envMinutes, envPort, envString, requireEnv } from '@randan/tg-bot-kit';

export interface EnvConfig {
  BOT_TOKEN: string;
  PORT: number;
  NODE_ENV: string;
  ADMIN_TELEGRAM_ID?: string;
  DB_URL: string;
  DB_SUBSCRIPTIONS_COLLECTION: string;
  DB_HISTORY_COLLECTION: string;
  DB_SCHEDULE_COLLECTION: string;
  TUYA_ACCESS_KEY: string;
  TUYA_SECRET_KEY: string;
  TUYA_BASE_URL: string;
  TUYA_DEVICE_ID: string;
  TUYA_POLL_INTERVAL_MINUTES: number;
  YASNO_REGION_ID: string;
  YASNO_DSO_ID: string;
  YASNO_STREET?: string;
  YASNO_HOUSE?: string;
  YASNO_GROUP?: string;
  YASNO_POLL_INTERVAL_MINUTES: number;
  TIMEZONE: string;
  LOG_LEVEL?: string;
}

/**
 * Minutes between polls are 1..59. Tuya Trial Edition allows ~26k API calls a
 * month: every 3 min is ~15k calls in a 31-day month.
 */
export function configValidationSchema(config: RawEnv): EnvConfig {
  return {
    BOT_TOKEN: requireEnv(config, 'BOT_TOKEN'),
    PORT: envPort(config),
    NODE_ENV: envString(config, 'NODE_ENV') || 'production',
    ADMIN_TELEGRAM_ID: envString(config, 'ADMIN_TELEGRAM_ID'),
    DB_URL: buildMongoUri(requireEnv(config, 'DB_URL')),
    DB_SUBSCRIPTIONS_COLLECTION: envString(config, 'DB_SUBSCRIPTIONS_COLLECTION') || 'light_subscriptions',
    DB_HISTORY_COLLECTION: envString(config, 'DB_HISTORY_COLLECTION') || 'light_history',
    DB_SCHEDULE_COLLECTION: envString(config, 'DB_SCHEDULE_COLLECTION') || 'outage_schedules',
    TUYA_ACCESS_KEY: requireEnv(config, 'TUYA_ACCESS_KEY'),
    TUYA_SECRET_KEY: requireEnv(config, 'TUYA_SECRET_KEY'),
    TUYA_BASE_URL: envString(config, 'TUYA_BASE_URL') || 'https://openapi.tuyaus.com',
    TUYA_DEVICE_ID: requireEnv(config, 'TUYA_DEVICE_ID'),
    TUYA_POLL_INTERVAL_MINUTES: envMinutes(config, 'TUYA_POLL_INTERVAL_MINUTES', 3),
    YASNO_REGION_ID: envString(config, 'YASNO_REGION_ID') || '25',
    YASNO_DSO_ID: envString(config, 'YASNO_DSO_ID') || '902',
    YASNO_STREET: envString(config, 'YASNO_STREET'),
    YASNO_HOUSE: envString(config, 'YASNO_HOUSE'),
    YASNO_GROUP: envString(config, 'YASNO_GROUP'),
    YASNO_POLL_INTERVAL_MINUTES: envMinutes(config, 'YASNO_POLL_INTERVAL_MINUTES', 10),
    TIMEZONE: requireEnv(config, 'TIMEZONE'),
    LOG_LEVEL: envString(config, 'LOG_LEVEL'),
  };
}
