import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { OutageSlot } from './schemas/outage-schedule.schema';

const BASE_URL = 'https://app.yasno.ua/api/blackout-service/public/shutdowns';
const REQUEST_TIMEOUT_MS = 15_000;

export interface YasnoDay {
  /** Kyiv date, YYYY-MM-DD. */
  date: string;
  status: string;
  slots: OutageSlot[];
}

export interface YasnoGroupSchedule {
  group: string;
  today: YasnoDay;
  tomorrow: YasnoDay;
  updatedOn?: Date;
}

interface YasnoDayResponse {
  date: string;
  status: string;
  slots?: OutageSlot[];
}

type YasnoPlannedResponse = Record<
  string,
  { today?: YasnoDayResponse; tomorrow?: YasnoDayResponse; updatedOn?: string }
>;

/**
 * Client for the public (undocumented) YASNO API that serves DTEK Kyiv
 * planned outage schedules. Responses are cached by YASNO for 5 minutes.
 */
@Injectable()
export class YasnoService {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const hasAddress = this.config.get<string>('YASNO_STREET_ID') && this.config.get<string>('YASNO_HOUSE_ID');
    return Boolean(this.config.get<string>('YASNO_GROUP') || hasAddress);
  }

  /**
   * Since 2026-10-13 Kyiv schedules are per building, so the group is resolved
   * from the address on every poll; YASNO_GROUP overrides it.
   */
  async resolveGroup(): Promise<string> {
    const fixedGroup = this.config.get<string>('YASNO_GROUP');
    if (fixedGroup) {
      return fixedGroup;
    }
    const data = await this.get<{ group: number; subgroup: number }>('/addresses/v2/group', {
      ...this.regionParams(),
      streetId: this.config.get<string>('YASNO_STREET_ID') ?? '',
      houseId: this.config.get<string>('YASNO_HOUSE_ID') ?? '',
    });
    return `${data.group}.${data.subgroup}`;
  }

  async getGroupSchedule(group: string): Promise<YasnoGroupSchedule> {
    const regionId = this.config.get<string>('YASNO_REGION_ID');
    const dsoId = this.config.get<string>('YASNO_DSO_ID');
    const data = await this.get<YasnoPlannedResponse>(`/regions/${regionId}/dsos/${dsoId}/planned-outages`);

    const groupData = data[group];
    if (!groupData?.today || !groupData.tomorrow) {
      throw new Error(`YASNO has no schedule for group ${group}`);
    }

    return {
      group,
      today: this.toDay(groupData.today),
      tomorrow: this.toDay(groupData.tomorrow),
      updatedOn: groupData.updatedOn ? new Date(groupData.updatedOn) : undefined,
    };
  }

  private toDay(day: YasnoDayResponse): YasnoDay {
    return {
      // "2026-10-15T00:00:00+03:00" is already a Kyiv date
      date: day.date.slice(0, 10),
      status: day.status,
      slots: (day.slots ?? []).map(({ start, end, type }) => ({ start, end, type })),
    };
  }

  private regionParams(): Record<string, string> {
    return {
      regionId: this.config.get<string>('YASNO_REGION_ID') ?? '',
      dsoId: this.config.get<string>('YASNO_DSO_ID') ?? '',
    };
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = `${BASE_URL}${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'light-tg-bot' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // YASNO explains a 404 in the body, e.g. "House 1 not found in RegionId 25 ..."
      const body = await response.text().catch(() => '');
      let detail = '';
      try {
        detail = (JSON.parse(body) as { detail?: string }).detail ?? '';
      } catch {
        // not JSON: an Incapsula challenge page or similar
      }
      throw new Error(`YASNO ${path} responded ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    return (await response.json()) as T;
  }
}
