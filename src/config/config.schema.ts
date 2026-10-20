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

function get(config: Record<string, unknown>, key: string): string | undefined {
  const v = config[key];
  return v === undefined ? undefined : String(v).trim() || undefined;
}

function requireKey(config: Record<string, unknown>, key: string): string {
  const value = get(config, key);
  if (value === undefined || value === '') {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

/**
 * Minutes between polls, 1..59. Tuya Trial Edition allows ~26k API calls a
 * month: every 3 min is ~15k calls in a 31-day month.
 */
function parseMinutes(key: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 59) {
    throw new Error(`${key} must be an integer 1..59, got "${raw}"`);
  }
  return minutes;
}

export function configValidationSchema(config: Record<string, unknown>): EnvConfig {
  const port = Number(get(config, 'PORT'));
  const portFinal = Number.isNaN(port) || port <= 0 ? 3000 : port;

  const dbUrl = requireKey(config, 'DB_URL');
  const dbMongooseUri = dbUrl.includes('?')
    ? `${dbUrl}&retryWrites=true&w=majority`
    : `${dbUrl}?retryWrites=true&w=majority`;

  return {
    BOT_TOKEN: requireKey(config, 'BOT_TOKEN'),
    PORT: portFinal,
    NODE_ENV: get(config, 'NODE_ENV') || 'production',
    ADMIN_TELEGRAM_ID: get(config, 'ADMIN_TELEGRAM_ID'),
    DB_URL: dbMongooseUri,
    DB_SUBSCRIPTIONS_COLLECTION: get(config, 'DB_SUBSCRIPTIONS_COLLECTION') || 'light_subscriptions',
    DB_HISTORY_COLLECTION: get(config, 'DB_HISTORY_COLLECTION') || 'light_history',
    DB_SCHEDULE_COLLECTION: get(config, 'DB_SCHEDULE_COLLECTION') || 'outage_schedules',
    TUYA_ACCESS_KEY: requireKey(config, 'TUYA_ACCESS_KEY'),
    TUYA_SECRET_KEY: requireKey(config, 'TUYA_SECRET_KEY'),
    TUYA_BASE_URL: get(config, 'TUYA_BASE_URL') || 'https://openapi.tuyaus.com',
    TUYA_DEVICE_ID: requireKey(config, 'TUYA_DEVICE_ID'),
    TUYA_POLL_INTERVAL_MINUTES: parseMinutes(
      'TUYA_POLL_INTERVAL_MINUTES',
      get(config, 'TUYA_POLL_INTERVAL_MINUTES'),
      3,
    ),
    YASNO_REGION_ID: get(config, 'YASNO_REGION_ID') || '25',
    YASNO_DSO_ID: get(config, 'YASNO_DSO_ID') || '902',
    YASNO_STREET: get(config, 'YASNO_STREET'),
    YASNO_HOUSE: get(config, 'YASNO_HOUSE'),
    YASNO_GROUP: get(config, 'YASNO_GROUP'),
    YASNO_POLL_INTERVAL_MINUTES: parseMinutes(
      'YASNO_POLL_INTERVAL_MINUTES',
      get(config, 'YASNO_POLL_INTERVAL_MINUTES'),
      10,
    ),
    TIMEZONE: requireKey(config, 'TIMEZONE'),
    LOG_LEVEL: get(config, 'LOG_LEVEL'),
  };
}
