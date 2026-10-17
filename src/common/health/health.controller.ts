import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { LightCronService } from '../../light/light-cron.service';

@Controller()
export class HealthController {
  constructor(private readonly cron: LightCronService) {}

  /** 503 when the power polling is stuck, so a monitor notices what the bot cannot report itself. */
  @Get('health')
  health(): { ok: boolean; lastCheckAt: Date | null } {
    const lastCheckAt = this.cron.getLastCheck()?.checkedAt ?? null;
    if (!this.cron.isPolling()) {
      throw new ServiceUnavailableException({ ok: false, reason: 'power polling is stuck', lastCheckAt });
    }
    return { ok: true, lastCheckAt };
  }
}
