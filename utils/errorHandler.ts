import bot from '../bot';
import { adminId } from './envVars';

interface ErrorContext {
  location?: string;
  userId?: number;
  deviceId?: string;
  additionalInfo?: string;
}

const RATE_LIMIT_MAX = 1;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const DEDUP_COOLDOWN_MS = 10 * 60 * 1000;
const BURST_THRESHOLD = 5;
const BURST_WINDOW_MS = 5 * 60 * 1000;

interface DedupEntry {
  lastSentAt: number;
  suppressedCount: number;
}

const dedupState = new Map<string, DedupEntry>();

let rateWindowStart = 0;
let rateCount = 0;

let burstWindowStart = 0;
let burstCount = 0;
let burstNotified = false;

const updateBurstState = (now: number): boolean => {
  if (burstWindowStart === 0 || now - burstWindowStart > BURST_WINDOW_MS) {
    burstWindowStart = now;
    burstCount = 0;
    burstNotified = false;
  }

  burstCount += 1;

  if (burstCount >= BURST_THRESHOLD && !burstNotified) {
    burstNotified = true;
    return true;
  }

  return false;
};

export const sendErrorToAdmin = async (error: Error | unknown, context?: ErrorContext): Promise<void> => {
  try {
    if (!adminId) {
      console.error('ADMIN_TG_ID is not configured, cannot send error notification');
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    const errorName = error instanceof Error ? error.name : 'Unknown Error';

    let message = `🚨 *Помилка в боті*\n\n`;
    message += `*Тип:* ${errorName}\n`;
    message += `*Повідомлення:* ${errorMessage}\n`;

    if (context?.location) {
      message += `*Місце:* ${context.location}\n`;
    }

    if (context?.userId) {
      message += `*User ID:* ${context.userId}\n`;
    }

    if (context?.deviceId) {
      message += `*Device ID:* ${context.deviceId}\n`;
    }

    if (context?.additionalInfo) {
      message += `*Додаткова інформація:* ${context.additionalInfo}\n`;
    }

    if (errorStack) {
      // Truncate stack trace if too long (Telegram has message limit)
      const maxStackLength = 1000;
      const truncatedStack =
        errorStack.length > maxStackLength ? errorStack.substring(0, maxStackLength) + '...' : errorStack;

      message += `\n*Stack trace:*\n\`\`\`\n${truncatedStack}\n\`\`\``;
    }

    message += `\n*Час:* ${new Date().toISOString()}`;

    await bot.sendMessage(Number(adminId), message, { parse_mode: 'Markdown' });
  } catch (sendError) {
    // If we can't send error to admin, at least log it
    console.error('Failed to send error notification to admin:', sendError);
    console.error('Original error:', error);
  }
};

export const sendErrorToAdminThrottled = async (
  error: Error | unknown,
  context: ErrorContext | undefined,
  throttleKey: string,
): Promise<void> => {
  const key = throttleKey || 'default';
  const now = Date.now();

  const shouldSendBurst = updateBurstState(now);
  if (shouldSendBurst) {
    await sendErrorToAdmin(new Error('Серія помилок'), {
      location: 'errorThrottle',
      additionalInfo: `Серія помилок: ${burstCount} за ${Math.round(BURST_WINDOW_MS / 60000)} хв. Ключ: ${key}`,
    });
  }

  const entry = dedupState.get(key) ?? { lastSentAt: 0, suppressedCount: 0 };

  if (entry.lastSentAt && now - entry.lastSentAt < DEDUP_COOLDOWN_MS) {
    entry.suppressedCount += 1;
    dedupState.set(key, entry);
    return;
  }

  if (rateWindowStart === 0 || now - rateWindowStart > RATE_LIMIT_WINDOW_MS) {
    rateWindowStart = now;
    rateCount = 0;
  }

  if (rateCount >= RATE_LIMIT_MAX) {
    entry.suppressedCount += 1;
    dedupState.set(key, entry);
    return;
  }

  const infoParts: string[] = [];
  if (context?.additionalInfo) {
    infoParts.push(context.additionalInfo);
  }
  if (entry.suppressedCount > 0) {
    infoParts.push(`Пропущено: ${entry.suppressedCount} повідомлень через rate limit/dedup`);
  }

  const mergedContext: ErrorContext | undefined =
    infoParts.length > 0 ? { ...context, additionalInfo: infoParts.join('\n') } : context;

  rateCount += 1;
  entry.lastSentAt = now;
  entry.suppressedCount = 0;
  dedupState.set(key, entry);

  await sendErrorToAdmin(error, mergedContext);
};

// Global error handlers
export const setupGlobalErrorHandlers = (): void => {
  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason: unknown) => {
    console.error('Unhandled Rejection:', reason);
    await sendErrorToAdmin(reason, {
      location: 'unhandledRejection',
      additionalInfo: 'Unhandled Promise Rejection',
    });
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error: Error) => {
    console.error('Uncaught Exception:', error);
    await sendErrorToAdmin(error, {
      location: 'uncaughtException',
      additionalInfo: 'Uncaught Exception',
    });
    // Exit process after uncaught exception
    process.exit(1);
  });
};
