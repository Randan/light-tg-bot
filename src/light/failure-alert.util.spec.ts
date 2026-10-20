import { FailureAlert } from './failure-alert.util';

describe('FailureAlert', () => {
  let sent: string[];
  let alert: FailureAlert;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-17T10:00:00Z'));
    sent = [];
    alert = new FailureAlert(message => sent.push(message), 'recovered', 60 * 60 * 1000);
  });

  afterEach(() => jest.useRealTimers());

  it('alerts once per interval while the failure lasts', () => {
    alert.fail('down');
    jest.advanceTimersByTime(30 * 60 * 1000);
    alert.fail('down');
    expect(sent).toEqual(['down']);

    jest.advanceTimersByTime(31 * 60 * 1000);
    alert.fail('still down');
    expect(sent).toEqual(['down', 'still down']);
  });

  it('tells once about the recovery, and only after an alert', () => {
    alert.ok();
    expect(sent).toEqual([]);

    alert.fail('down');
    alert.ok();
    alert.ok();
    expect(sent).toEqual(['down', 'recovered']);
  });

  it('alerts again right away about a new failure after a recovery', () => {
    alert.fail('down');
    alert.ok();
    alert.fail('down again');
    expect(sent).toEqual(['down', 'recovered', 'down again']);
  });
});
