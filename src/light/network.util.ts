import * as https from 'https';

const CONNECTIVITY_CHECK_URL = 'https://connectivitycheck.gstatic.com/generate_204';

/** Whether the URL answers at all; any HTTP status counts, unless `expectStatus` is given. */
function isReachable(url: string, timeoutMs: number, expectStatus?: number): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const req = https.get(url, res => {
      res.resume();
      finish(expectStatus === undefined || res.statusCode === expectStatus);
    });
    req.on('error', () => finish(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(false);
    });
  });
}

/**
 * The server is online when Google's connectivity check or the API it is about
 * to call answers: one blocked host alone must not stop the polling.
 */
export async function isNetworkAvailable(apiUrl?: string, timeoutMs = 5000): Promise<boolean> {
  if (await isReachable(CONNECTIVITY_CHECK_URL, timeoutMs, 204)) {
    return true;
  }
  return apiUrl ? isReachable(apiUrl, timeoutMs) : false;
}
