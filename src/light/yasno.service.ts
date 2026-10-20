import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { OutageSlot } from './schemas/outage-schedule.schema';
import type { YasnoAddressEntry } from './yasno-address.util';
import { normalizeHouse, normalizeStreet, pickAddressEntry } from './yasno-address.util';

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

/** The address ids YASNO knows the house by; they are internal and change. */
export interface YasnoAddress {
  street: string;
  house: string;
  streetId: number;
  houseId: number;
}

/** YASNO answered 404: the ids it was given no longer exist. */
export class YasnoNotFoundError extends Error {}

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

  /** Address ids found by name, reused until YASNO stops recognizing them. */
  private address: YasnoAddress | null = null;

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('YASNO_GROUP') || this.hasAddress());
  }

  hasAddress(): boolean {
    return Boolean(this.config.get<string>('YASNO_STREET') && this.config.get<string>('YASNO_HOUSE'));
  }

  /** The address ids in use, if already found. */
  getAddress(): YasnoAddress | null {
    return this.address;
  }

  /**
   * The group of the configured address. The address is kept by name, not by
   * id: YASNO renumbered every street and house on 2026-10-17, so stored ids are
   * looked up again by name as soon as YASNO answers 404 for them.
   */
  async resolveGroupByAddress(): Promise<string> {
    if (this.address) {
      try {
        return await this.fetchGroup(this.address);
      } catch (err) {
        if (!(err instanceof YasnoNotFoundError)) {
          throw err;
        }
        this.address = null;
      }
    }
    const address = await this.findAddress();
    const group = await this.fetchGroup(address);
    this.address = address;
    return group;
  }

  private async findAddress(): Promise<YasnoAddress> {
    const street = this.config.get<string>('YASNO_STREET') ?? '';
    const house = this.config.get<string>('YASNO_HOUSE') ?? '';

    const streets = await this.get<YasnoAddressEntry[]>('/addresses/v2/streets', {
      ...this.regionParams(),
      query: normalizeStreet(street),
    });
    const streetEntry = pickAddressEntry(streets, street, normalizeStreet, 'street');

    const houses = await this.get<YasnoAddressEntry[]>('/addresses/v2/houses', {
      ...this.regionParams(),
      streetId: String(streetEntry.id),
      query: house,
    });
    const houseEntry = pickAddressEntry(houses, house, normalizeHouse, 'house');

    return { street: streetEntry.value, house: houseEntry.value, streetId: streetEntry.id, houseId: houseEntry.id };
  }

  private async fetchGroup(address: YasnoAddress): Promise<string> {
    const data = await this.get<{ group: number; subgroup: number }>('/addresses/v2/group', {
      ...this.regionParams(),
      streetId: String(address.streetId),
      houseId: String(address.houseId),
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
      const message = `YASNO ${path} responded ${response.status}${detail ? `: ${detail}` : ''}`;
      throw response.status === 404 ? new YasnoNotFoundError(message) : new Error(message);
    }
    return (await response.json()) as T;
  }
}
