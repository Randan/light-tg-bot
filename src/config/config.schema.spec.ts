import { configValidationSchema } from './config.schema';

const required = {
  BOT_TOKEN: 'token',
  DB_URL: 'mongodb+srv://user:pass@cluster0.example.net/light-tg-bot',
  TUYA_ACCESS_KEY: 'access',
  TUYA_SECRET_KEY: 'secret',
  TUYA_DEVICE_ID: 'device',
  TIMEZONE: 'Europe/Kyiv',
};

describe('configValidationSchema', () => {
  it('fills the defaults', () => {
    const config = configValidationSchema(required);
    expect(config).toMatchObject({
      PORT: 3000,
      NODE_ENV: 'production',
      DB_SUBSCRIPTIONS_COLLECTION: 'light_subscriptions',
      DB_HISTORY_COLLECTION: 'light_history',
      DB_SCHEDULE_COLLECTION: 'outage_schedules',
      TUYA_BASE_URL: 'https://openapi.tuyaus.com',
      TUYA_POLL_INTERVAL_MINUTES: 3,
      YASNO_REGION_ID: '25',
      YASNO_DSO_ID: '902',
      YASNO_POLL_INTERVAL_MINUTES: 10,
    });
    expect(config.YASNO_STREET).toBeUndefined();
    expect(config.ADMIN_TELEGRAM_ID).toBeUndefined();
  });

  it.each(Object.keys(required))('requires %s', key => {
    expect(() => configValidationSchema({ ...required, [key]: '' })).toThrow(`Missing required env: ${key}`);
  });

  it('trims values and treats blank ones as unset', () => {
    const config = configValidationSchema({ ...required, YASNO_STREET: '  Тираспольська ', YASNO_GROUP: '   ' });
    expect(config.YASNO_STREET).toBe('Тираспольська');
    expect(config.YASNO_GROUP).toBeUndefined();
  });

  it('adds the write options to the Mongo URL, keeping its own query', () => {
    expect(configValidationSchema(required).DB_URL).toBe(`${required.DB_URL}?retryWrites=true&w=majority`);
    expect(configValidationSchema({ ...required, DB_URL: 'mongodb://h/db?appName=x' }).DB_URL).toBe(
      'mongodb://h/db?appName=x&retryWrites=true&w=majority',
    );
  });

  it('falls back to port 3000 on a bad PORT', () => {
    expect(configValidationSchema({ ...required, PORT: '4204' }).PORT).toBe(4204);
    expect(configValidationSchema({ ...required, PORT: 'abc' }).PORT).toBe(3000);
    expect(configValidationSchema({ ...required, PORT: '-1' }).PORT).toBe(3000);
  });

  it.each(['0', '60', '2.5', 'abc'])('rejects a poll interval of %s', value => {
    expect(() => configValidationSchema({ ...required, TUYA_POLL_INTERVAL_MINUTES: value })).toThrow(
      'TUYA_POLL_INTERVAL_MINUTES must be an integer 1..59',
    );
    expect(() => configValidationSchema({ ...required, YASNO_POLL_INTERVAL_MINUTES: value })).toThrow(
      'YASNO_POLL_INTERVAL_MINUTES must be an integer 1..59',
    );
  });

  it('accepts poll intervals at the bounds', () => {
    const config = configValidationSchema({
      ...required,
      TUYA_POLL_INTERVAL_MINUTES: '1',
      YASNO_POLL_INTERVAL_MINUTES: 59,
    });
    expect(config.TUYA_POLL_INTERVAL_MINUTES).toBe(1);
    expect(config.YASNO_POLL_INTERVAL_MINUTES).toBe(59);
  });
});
