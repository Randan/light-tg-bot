import formatTime from './formatTime';
import { logger } from './logger';
import {
  adminId,
  appPort,
  dbLightCollection,
  dbLightHistoryCollection,
  dbMongooseUri,
  env,
  localDbName,
  socketId,
  tuyaAccessKey,
  tuyaBaseUrl,
  tuyaSecretKey,
} from './envVars';

export {
  adminId,
  appPort,
  formatTime,
  dbLightCollection,
  dbLightHistoryCollection,
  dbMongooseUri,
  env,
  localDbName,
  socketId,
  tuyaAccessKey,
  logger,
  tuyaSecretKey,
  tuyaBaseUrl,
};

export { sendErrorToAdmin, setupGlobalErrorHandlers } from './errorHandler';
