import 'dotenv/config';
import cron from 'node-cron';
import { checkTuyaStatus } from '../controllers';

const cronOptions = {
  scheduled: true,
  timezone: process.env.TIMEZONE,
};

// Check Tuya device status once per minute
cron.schedule('* * * * *', () => checkTuyaStatus(), cronOptions);
