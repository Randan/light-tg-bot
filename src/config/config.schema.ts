export interface EnvConfig {
  BOT_TOKEN: string;
  PORT: number;
  NODE_ENV: string;
  ADMIN_TELEGRAM_ID?: string;
  DB_URL: string;
  DB_LIGHT_COLLECTION: string;
  DB_LIGHT_HISTORY_COLLECTION: string;
  LOCAL_DB_NAME: string;
  TUYA_ACCESS_KEY: string;
  TUYA_SECRET_KEY: string;
  TUYA_BASE_URL: string;
  TUYA_DEVICE_ID: string;
  TIMEZONE: string;
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

export function configValidationSchema(
  config: Record<string, unknown>,
): EnvConfig {
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
    DB_LIGHT_COLLECTION: requireKey(config, 'DB_LIGHT_COLLECTION'),
    DB_LIGHT_HISTORY_COLLECTION:
      get(config, 'DB_LIGHT_HISTORY_COLLECTION') || 'light_history',
    LOCAL_DB_NAME: requireKey(config, 'LOCAL_DB_NAME'),
    TUYA_ACCESS_KEY: requireKey(config, 'TUYA_ACCESS_KEY'),
    TUYA_SECRET_KEY: requireKey(config, 'TUYA_SECRET_KEY'),
    TUYA_BASE_URL:
      get(config, 'TUYA_BASE_URL') || 'https://openapi.tuyaus.com',
    TUYA_DEVICE_ID: requireKey(config, 'TUYA_DEVICE_ID'),
    TIMEZONE: requireKey(config, 'TIMEZONE'),
  };
}
