// @ts-expect-error - NTBA_FIX_319 is a workaround for known issue
process.env.NTBA_FIX_319 = 1; // Fix of 319 error

/* eslint-disable import/first */
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';

const bot: TelegramBot = new TelegramBot(process.env.BOT_API || '', { polling: true });

export default bot;
