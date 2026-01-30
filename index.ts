process.env.NTBA_FIX_319 = '1';

/* eslint-disable import/first */
import type { Express, Request, Response } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import { setValue } from 'node-global-storage';
import {
  appPort,
  dbMongooseUri,
  localDbName,
  logger,
  sendErrorToAdmin,
  sendErrorToAdminThrottled,
  setupGlobalErrorHandlers,
} from './utils';
import type { ILightRecord } from './interfaces';
import { LightRecords } from './schemas';

// Setup global error handlers
setupGlobalErrorHandlers();

const app: Express = express();

// MongoDB reconnection logic
let reconnectAttempts = 0;
const maxReconnectDelay = 30000; // 30 seconds max delay
let reconnectTimeout: NodeJS.Timeout | null = null;

const reconnectToMongoDB = async (): Promise<void> => {
  // Clear any existing reconnect timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // If already connected, don't reconnect
  if (mongoose.connection.readyState === 1) {
    reconnectAttempts = 0;
    return;
  }

  // Calculate exponential backoff delay (capped at maxReconnectDelay)
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), maxReconnectDelay);
  reconnectAttempts += 1;

  logger.warn(`⏳ Attempting to reconnect to MongoDB in ${delay}ms (attempt ${reconnectAttempts})...`);

  reconnectTimeout = setTimeout(async () => {
    try {
      await mongoose.connect(dbMongooseUri);
      logger.log('✅ Successfully reconnected to MongoDB');
      reconnectAttempts = 0;
    } catch (err) {
      logger.error('❌ Failed to reconnect to MongoDB:', err);
      await sendErrorToAdminThrottled(
        err as Error,
        {
          location: 'index.ts - reconnectToMongoDB',
          additionalInfo: `Reconnection attempt ${reconnectAttempts} failed`,
        },
        'mongo.reconnect_failed',
      );
      // Try again
      reconnectToMongoDB();
    }
  }, delay);
};

// Connect to MongoDB and wait for connection
mongoose.connect(dbMongooseUri).catch(err => {
  logger.error('Failed to connect to MongoDB:', err);
  sendErrorToAdminThrottled(
    err,
    {
      location: 'index.ts - mongoose.connect',
      additionalInfo: 'Failed to connect to MongoDB on startup',
    },
    'mongo.connect_failed',
  );
  // Try to reconnect
  reconnectToMongoDB();
});

// Wait for MongoDB connection before starting server
mongoose.connection.on('connected', async () => {
  logger.log('✅ Connected to MongoDB');
  reconnectAttempts = 0; // Reset attempts on successful connection

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

mongoose.connection.on('error', err => {
  logger.error('MongoDB connection error:', err);
  sendErrorToAdminThrottled(
    err,
    {
      location: 'index.ts - mongoose.connection.on(error)',
      additionalInfo: 'MongoDB connection error',
    },
    'mongo.error',
  );
});

mongoose.connection.on('disconnected', () => {
  logger.warn('⚠️ MongoDB disconnected - attempting to reconnect...');
  sendErrorToAdminThrottled(
    new Error('MongoDB disconnected'),
    {
      location: 'index.ts - mongoose.connection.on(disconnected)',
      additionalInfo: 'MongoDB connection lost - attempting automatic reconnection',
    },
    'mongo.disconnected',
  );
  // Automatically attempt to reconnect
  reconnectToMongoDB();
});

app.get('/', (req: Request, res: Response): void => {
  res.status(200).send('Light Bot is Alive');
});

import './events';

app.listen(appPort, () => {
  logger.log(`⚡⚡⚡ Light Bot is Alive on PORT: ${appPort}`);
});

import './cron';
