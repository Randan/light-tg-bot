import { EventEmitter } from 'events';
import * as https from 'https';

import { isNetworkAvailable } from './network.util';

jest.mock('https', () => ({ get: jest.fn() }));

type Outcome = { status: number } | 'error' | 'timeout';

/** Answers each https.get by URL with a status, an error, or no answer at all. */
function serve(outcomes: Record<string, Outcome>): string[] {
  const asked: string[] = [];
  (https.get as unknown as jest.Mock).mockImplementation((url: string, onResponse: (res: unknown) => void) => {
    asked.push(url);
    const req = Object.assign(new EventEmitter(), {
      destroy: jest.fn(),
      setTimeout: (_ms: number, onTimeout: () => void) => {
        if (outcome === 'timeout') {
          setImmediate(onTimeout);
        }
      },
    });
    const outcome = outcomes[url];
    setImmediate(() => {
      if (outcome === 'error') {
        req.emit('error', new Error('ENOTFOUND'));
      } else if (outcome && outcome !== 'timeout') {
        onResponse({ statusCode: outcome.status, resume: jest.fn() });
      }
    });
    return req;
  });
  return asked;
}

const GOOGLE = 'https://connectivitycheck.gstatic.com/generate_204';
const TUYA = 'https://openapi.tuyaeu.com';

describe('isNetworkAvailable', () => {
  it('is up when Google answers 204, without asking the API', async () => {
    const asked = serve({ [GOOGLE]: { status: 204 } });
    await expect(isNetworkAvailable(TUYA)).resolves.toBe(true);
    expect(asked).toEqual([GOOGLE]);
  });

  it('falls back to the API when Google is blocked; any API status counts', async () => {
    serve({ [GOOGLE]: 'error', [TUYA]: { status: 404 } });
    await expect(isNetworkAvailable(TUYA)).resolves.toBe(true);
  });

  it('does not take a captive portal (non-204 from Google) alone as online', async () => {
    serve({ [GOOGLE]: { status: 200 } });
    await expect(isNetworkAvailable()).resolves.toBe(false);
  });

  it('is down when neither answers', async () => {
    serve({ [GOOGLE]: 'timeout', [TUYA]: 'error' });
    await expect(isNetworkAvailable(TUYA)).resolves.toBe(false);
  });
});
