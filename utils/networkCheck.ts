import * as https from 'https';
import { logger } from './logger';

const DEFAULT_CHECK_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 10000;

export const isNetworkAvailable = (timeoutMs = DEFAULT_CHECK_TIMEOUT_MS): Promise<boolean> =>
  new Promise(resolve => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = https.get('https://connectivitycheck.gstatic.com/generate_204', res => {
      res.resume();
      finish(res.statusCode === 204);
    });
    req.on('error', () => finish(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(false);
    });
  });

let wasWaitingForNetwork = false;

export const waitForNetwork = (options?: { intervalMs?: number }): Promise<void> => {
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;

  const poll = (): Promise<void> =>
    isNetworkAvailable().then(ok => {
      if (ok) {
        if (wasWaitingForNetwork) {
          logger.log('Network restored');
          wasWaitingForNetwork = false;
        }
        return;
      }
      if (!wasWaitingForNetwork) {
        logger.warn('Waiting for network...');
        wasWaitingForNetwork = true;
      }
      return new Promise<void>(resolve => setTimeout(() => resolve(), intervalMs)).then(poll);
    });

  return poll();
};
