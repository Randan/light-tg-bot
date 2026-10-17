const HOUR_MS = 60 * 60 * 1000;

/**
 * Tells the admin about an ongoing failure at most once per interval, and once
 * more when it is over, so a silence after an alert means "still broken".
 */
export class FailureAlert {
  private lastNotifiedAt = 0;
  private notified = false;

  constructor(
    private readonly send: (message: string) => void,
    private readonly recoveredMessage: string,
    private readonly intervalMs = HOUR_MS,
  ) {}

  fail(message: string): void {
    const now = Date.now();
    if (now - this.lastNotifiedAt < this.intervalMs) {
      return;
    }
    this.lastNotifiedAt = now;
    this.notified = true;
    this.send(message);
  }

  ok(): void {
    if (!this.notified) {
      return;
    }
    this.notified = false;
    this.lastNotifiedAt = 0;
    this.send(this.recoveredMessage);
  }
}
