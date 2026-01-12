import 'dotenv/config';

const appPort: string = process.env.PORT || '';
const dbUrl: string = process.env.DB_URL || '';
const adminId: string = process.env.ADMIN_TG_ID || '';
const dbLightCollection: string = process.env.DB_LIGHT_COLLECTION || '';
const dbLightHistoryCollection: string = process.env.DB_LIGHT_HISTORY_COLLECTION || 'light_history';
const localDbName: string = process.env.LOCAL_DB_NAME || '';
const tuyaAccessKey: string = process.env.TUYA_ACCESS_KEY || '';
const tuyaSecretKey: string = process.env.TUYA_SECRET_KEY || '';
const tuyaBaseUrl: string = process.env.TUYA_BASE_URL || 'https://openapi.tuyaus.com';
const socketId: string = process.env.SOCKET_ID || 'https://openapi.tuyaus.com';
const env: string = process.env.ENV || 'prod';

const dbMongooseUri: string = dbUrl ? dbUrl + '?retryWrites=true&w=majority' : '';

export {
  adminId,
  appPort,
  dbLightCollection,
  dbLightHistoryCollection,
  dbMongooseUri,
  env,
  localDbName,
  tuyaAccessKey,
  tuyaSecretKey,
  tuyaBaseUrl,
  socketId,
};
