import { ServiceUnavailableException } from '@nestjs/common';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  const checkedAt = new Date('2026-10-20T09:00:00Z');

  it('is ok while the power polling runs', () => {
    const cron = { isPolling: () => true, getLastCheck: () => ({ status: true, checkedAt }) };
    expect(new HealthController(cron as never).health()).toEqual({ ok: true, lastCheckAt: checkedAt });
  });

  it('answers 503 once the polling is stuck, so Docker marks the container unhealthy', () => {
    const cron = { isPolling: () => false, getLastCheck: () => null };
    expect(() => new HealthController(cron as never).health()).toThrow(ServiceUnavailableException);
  });
});
