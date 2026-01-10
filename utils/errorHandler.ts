import bot from '../bot';
import { adminId } from './envVars';

interface ErrorContext {
  location?: string;
  userId?: number;
  deviceId?: string;
  additionalInfo?: string;
}

export const sendErrorToAdmin = async (
  error: Error | unknown,
  context?: ErrorContext
): Promise<void> => {
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
        errorStack.length > maxStackLength
          ? errorStack.substring(0, maxStackLength) + '...'
          : errorStack;

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
