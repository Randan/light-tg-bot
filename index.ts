process.env.NTBA_FIX_319 = '1';

/* eslint-disable import/first */
import express, { Express, Request, Response } from 'express';
import mongoose from 'mongoose';
import { setValue } from 'node-global-storage';
import { appPort, dbMongooseUri, localDbName, logger, setupGlobalErrorHandlers, sendErrorToAdmin } from './utils';
import { ILightRecord } from './interfaces';
import { LightRecords } from './schemas';

// Setup global error handlers
setupGlobalErrorHandlers();

const app: Express = express();

// Connect to MongoDB and wait for connection
mongoose.connect(dbMongooseUri).catch((err) => {
  logger.error('Failed to connect to MongoDB:', err);
  sendErrorToAdmin(err, {
    location: 'index.ts - mongoose.connect',
    additionalInfo: 'Failed to connect to MongoDB on startup',
  });
});

// Wait for MongoDB connection before starting server
mongoose.connection.on('connected', async () => {
  logger.log('✅ Connected to MongoDB');

  try {
    const response: ILightRecord[] = await LightRecords.find({
      userIds: { $not: { $size: 0 } },
    });

    setValue(localDbName, response);
    logger.log(`✅ Loaded ${response.length} light records into memory`);
  } catch (err) {
    logger.error('Failed to update light records', err);
    await sendErrorToAdmin(err, {
      location: 'index.ts - mongoose.connection.on(connected)',
      additionalInfo: 'Failed to update light records on startup',
    });
  }
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB connection error:', err);
  sendErrorToAdmin(err, {
    location: 'index.ts - mongoose.connection.on(error)',
    additionalInfo: 'MongoDB connection error',
  });
});

mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️ MongoDB disconnected');
  sendErrorToAdmin(new Error('MongoDB disconnected'), {
    location: 'index.ts - mongoose.connection.on(disconnected)',
    additionalInfo: 'MongoDB connection lost',
  });
});

app.get('/', (req: Request, res: Response): void => {
  res.status(200).send('Light Bot is Alive');
});

import './events';

app.listen(appPort, () => {
  logger.log(`⚡⚡⚡ Light Bot is Alive on PORT: ${appPort}`);
});

import './cron';
