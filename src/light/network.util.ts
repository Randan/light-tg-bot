import * as https from 'https';

export function isNetworkAvailable(timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = https.get(
      'https://connectivitycheck.gstatic.com/generate_204',
      (res) => {
        res.resume();
        finish(res.statusCode === 204);
      },
    );
    req.on('error', () => finish(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish(false);
    });
  });
}
