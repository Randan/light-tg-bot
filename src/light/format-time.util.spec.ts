import { formatTime, getForm } from './format-time.util';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('getForm', () => {
  it.each([
    [1, 'один'],
    [21, 'один'],
    [2, 'кілька'],
    [24, 'кілька'],
    [5, 'багато'],
    [11, 'багато'],
    [12, 'багато'],
    [14, 'багато'],
    [111, 'багато'],
    [0, 'багато'],
  ])('%i → %s', (count, form) => {
    expect(getForm(count, 'один', 'кілька', 'багато')).toBe(form);
  });
});

describe('formatTime', () => {
  it.each([
    [30 * 1000, 'менше хвилини'],
    [MIN, '1 хвилина'],
    [22 * MIN, '22 хвилини'],
    [HOUR, '1 година'],
    [2 * HOUR + 5 * MIN, '2 години 5 хвилин'],
    [17 * HOUR + 53 * MIN, '17 годин 53 хвилини'],
    [DAY, '1 день'],
    [3 * DAY + 4 * HOUR, '3 дні 4 години'],
    [30 * DAY, '1 місяць'],
    [65 * DAY, '2 місяці 5 днів'],
    [360 * DAY, '1 рік'],
    [400 * DAY, '1 рік 1 місяць'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatTime(ms)).toBe(text);
  });
});
