import { YasnoNotFoundError, YasnoService } from './yasno.service';

type Reply = { status?: number; body: unknown };

describe('YasnoService', () => {
  let env: Record<string, string>;
  let replies: Record<string, Reply>;
  let asked: string[];
  let service: YasnoService;

  /** Answers fetch by path+query, so a test lists what YASNO says to each request. */
  beforeEach(() => {
    env = { YASNO_REGION_ID: '25', YASNO_DSO_ID: '902', YASNO_STREET: 'Тираспольська', YASNO_HOUSE: '54' };
    replies = {};
    asked = [];
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const key = `${url.pathname.replace('/api/blackout-service/public/shutdowns', '')}${url.search}`;
      asked.push(key);
      const reply = Object.entries(replies).find(([prefix]) => key.startsWith(prefix))?.[1];
      const status = reply?.status ?? (reply ? 200 : 500);
      const text = typeof reply?.body === 'string' ? reply.body : JSON.stringify(reply?.body ?? {});
      return { ok: status < 400, status, json: async () => JSON.parse(text), text: async () => text } as Response;
    }) as typeof fetch;
    service = new YasnoService({ get: (key: string) => env[key] } as never);
  });

  const streetQuery = `/addresses/v2/streets?regionId=25&dsoId=902&query=${encodeURIComponent('тираспольська')}`;

  function serveAddress(streetId: number, houseId: number, group = { group: 2, subgroup: 1 }) {
    replies[streetQuery] = { body: [{ id: streetId, value: 'вул. Тираспольська' }] };
    replies[`/addresses/v2/houses?regionId=25&dsoId=902&streetId=${streetId}`] = {
      body: [{ id: houseId, value: '54' }],
    };
    replies[`/addresses/v2/group?regionId=25&dsoId=902&streetId=${streetId}&houseId=${houseId}`] = { body: group };
  }

  describe('isConfigured', () => {
    it('needs both the street and the house, or a fixed group', () => {
      expect(service.isConfigured()).toBe(true);
      delete env.YASNO_HOUSE;
      expect(service.isConfigured()).toBe(false);
      env.YASNO_GROUP = '2.1';
      expect(service.isConfigured()).toBe(true);
      expect(service.hasAddress()).toBe(false);
    });
  });

  describe('resolveGroupByAddress', () => {
    it('finds the ids by name, then reuses them', async () => {
      serveAddress(896, 38502);
      await expect(service.resolveGroupByAddress()).resolves.toBe('2.1');
      expect(service.getAddress()).toEqual({
        street: 'вул. Тираспольська',
        house: '54',
        streetId: 896,
        houseId: 38502,
      });

      asked = [];
      await service.resolveGroupByAddress();
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain('/addresses/v2/group');
    });

    it('looks the ids up again when YASNO renumbers its addresses (17.10.2026)', async () => {
      serveAddress(962, 40503);
      await service.resolveGroupByAddress();

      // the old ids now answer 404 and the search returns new ones
      replies[`/addresses/v2/group?regionId=25&dsoId=902&streetId=962&houseId=40503`] = {
        status: 404,
        body: { detail: 'House 40503 not found in RegionId 25 and DsoId 902 and StreetId 962' },
      };
      serveAddress(896, 38502);

      await expect(service.resolveGroupByAddress()).resolves.toBe('2.1');
      expect(service.getAddress()?.houseId).toBe(38502);
    });

    it('keeps the ids on a server error: only a 404 means they are stale', async () => {
      serveAddress(896, 38502);
      await service.resolveGroupByAddress();
      replies[`/addresses/v2/group?regionId=25&dsoId=902&streetId=896&houseId=38502`] = { status: 500, body: {} };

      await expect(service.resolveGroupByAddress()).rejects.toThrow('responded 500');
      expect(service.getAddress()?.houseId).toBe(38502);
    });

    it('fails clearly when the house is not found', async () => {
      replies[streetQuery] = { body: [{ id: 896, value: 'вул. Тираспольська' }] };
      replies['/addresses/v2/houses'] = { body: [{ id: 1, value: '54А' }] };
      await expect(service.resolveGroupByAddress()).rejects.toThrow('YASNO house "54" is ambiguous or missing');
      expect(service.getAddress()).toBeNull();
    });
  });

  describe('getGroupSchedule', () => {
    const planned = '/regions/25/dsos/902/planned-outages';

    it("takes the group's days, with Kyiv dates", async () => {
      replies[planned] = {
        body: {
          '2.1': {
            today: {
              date: '2026-10-20T00:00:00+03:00',
              status: 'ScheduleApplies',
              slots: [{ start: 480, end: 690, type: 'Definite', extra: 1 }],
            },
            tomorrow: { date: '2026-10-21T00:00:00+03:00', status: 'WaitingForSchedule' },
            updatedOn: '2026-10-19T17:30:02+00:00',
          },
        },
      };
      await expect(service.getGroupSchedule('2.1')).resolves.toEqual({
        group: '2.1',
        today: { date: '2026-10-20', status: 'ScheduleApplies', slots: [{ start: 480, end: 690, type: 'Definite' }] },
        tomorrow: { date: '2026-10-21', status: 'WaitingForSchedule', slots: [] },
        updatedOn: new Date('2026-10-19T17:30:02Z'),
      });
    });

    it('fails when the group is not in the answer', async () => {
      replies[planned] = { body: { '1.1': {} } };
      await expect(service.getGroupSchedule('2.1')).rejects.toThrow('YASNO has no schedule for group 2.1');
    });
  });

  describe('errors', () => {
    it("explain a 404 with YASNO's own detail", async () => {
      replies[streetQuery] = { status: 404, body: { detail: 'Street not found' } };
      const error = await service.resolveGroupByAddress().catch(err => err);
      expect(error).toBeInstanceOf(YasnoNotFoundError);
      expect(error.message).toBe('YASNO /addresses/v2/streets responded 404: Street not found');
    });

    it('survive a non-JSON body such as a bot-protection page', async () => {
      replies[streetQuery] = { status: 503, body: '<html>Incapsula</html>' };
      await expect(service.resolveGroupByAddress()).rejects.toThrow(/^YASNO \/addresses\/v2\/streets responded 503$/);
    });
  });
});
