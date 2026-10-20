import { TuyaContext } from '@tuya/tuya-connector-nodejs';

import { LightTuyaService } from './light-tuya.service';

jest.mock('@tuya/tuya-connector-nodejs', () => ({ TuyaContext: jest.fn() }));

describe('LightTuyaService.isDeviceOnline', () => {
  let detail: jest.Mock;
  let adminMessages: string[];
  let service: LightTuyaService;
  const env: Record<string, string> = {
    TUYA_ACCESS_KEY: 'access',
    TUYA_SECRET_KEY: 'secret',
    TUYA_BASE_URL: 'https://openapi.tuyaeu.com',
  };

  beforeEach(() => {
    detail = jest.fn();
    (TuyaContext as unknown as jest.Mock).mockReset().mockImplementation(() => ({ device: { detail } }));
    adminMessages = [];
    service = new LightTuyaService(
      { get: (key: string) => env[key] } as never,
      { log: jest.fn(), error: jest.fn() } as never,
      { send: (message: string) => adminMessages.push(message) } as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it.each([true, false])('reads online=%s', async online => {
    detail.mockResolvedValue({ success: true, result: { online } });
    await expect(service.isDeviceOnline('dev')).resolves.toBe(online);
    expect(service.getLastError()).toBeNull();
    expect(service.getHealth().lastSuccessAt).toBeInstanceOf(Date);
  });

  it('reads the flag nested one level deeper too', async () => {
    detail.mockResolvedValue({ success: true, result: { result: { online: true } } });
    await expect(service.isDeviceOnline('dev')).resolves.toBe(true);
  });

  it('builds the client once, so the access token is reused', async () => {
    detail.mockResolvedValue({ success: true, result: { online: true } });
    await service.isDeviceOnline('dev');
    await service.isDeviceOnline('dev');
    expect(TuyaContext).toHaveBeenCalledTimes(1);
    expect(TuyaContext).toHaveBeenCalledWith({ accessKey: 'access', secretKey: 'secret', baseUrl: env.TUYA_BASE_URL });
  });

  it('is unknown, not offline, when Tuya rejects the request', async () => {
    detail.mockResolvedValue({ success: false, code: 28841002, msg: 'subscription has expired' });
    await expect(service.isDeviceOnline('dev')).resolves.toBeNull();
    expect(service.getLastError()).toBe('code=28841002 msg=subscription has expired');
    expect(adminMessages[0]).toContain('code=28841002');
  });

  it('is unknown, not offline, when the answer has no online flag', async () => {
    detail.mockResolvedValue({ success: true, result: {} });
    await expect(service.isDeviceOnline('dev')).resolves.toBeNull();
    expect(service.getLastError()).toBe('no online flag in the response');
  });

  it('is unknown when the call throws', async () => {
    detail.mockRejectedValue(new Error('socket hang up'));
    await expect(service.isDeviceOnline('dev')).resolves.toBeNull();
    expect(service.getLastError()).toBe('socket hang up');
  });

  it('gives up on a call Tuya never answers', async () => {
    jest.useFakeTimers();
    detail.mockReturnValue(new Promise(() => undefined));
    const result = service.isDeviceOnline('dev');
    await jest.advanceTimersByTimeAsync(20_000);
    await expect(result).resolves.toBeNull();
    expect(service.getLastError()).toBe('no answer in 20s');
  });

  it('is unknown when the keys are missing', async () => {
    delete env.TUYA_SECRET_KEY;
    await expect(service.isDeviceOnline('dev')).resolves.toBeNull();
    expect(service.getLastError()).toBe('Tuya config missing');
    env.TUYA_SECRET_KEY = 'secret';
  });

  it('alerts once per failure, tells about the recovery, and keeps the last failure for /diag', async () => {
    detail.mockResolvedValue({ success: false, code: 500, msg: 'system error' });
    await service.isDeviceOnline('dev');
    await service.isDeviceOnline('dev');
    detail.mockResolvedValue({ success: true, result: { online: true } });
    await service.isDeviceOnline('dev');

    expect(adminMessages).toHaveLength(2);
    expect(adminMessages[1]).toBe('✅ Tuya API відповідає знову');
    expect(service.getLastError()).toBeNull();
    expect(service.getHealth().lastFailure?.message).toBe('code=500 msg=system error');
  });
});
