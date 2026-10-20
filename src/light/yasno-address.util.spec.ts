import { normalizeHouse, normalizeStreet, pickAddressEntry } from './yasno-address.util';

describe('pickAddressEntry', () => {
  const streets = [
    { id: 896, value: 'вул. Тираспольська' },
    { id: 900, value: 'пров. Тираспольський' },
  ];

  it('matches a street with or without its type prefix', () => {
    expect(pickAddressEntry(streets, 'Тираспольська', normalizeStreet, 'street').id).toBe(896);
    expect(pickAddressEntry(streets, 'вул. тираспольська ', normalizeStreet, 'street').id).toBe(896);
  });

  it('treats the apostrophe variants alike', () => {
    const entries = [{ id: 1, value: 'вул. Обʼєднана' }];
    expect(pickAddressEntry(entries, "Об'єднана", normalizeStreet, 'street').id).toBe(1);
  });

  it('matches a house exactly, never a neighbour', () => {
    const houses = [
      { id: 38502, value: '54' },
      { id: 38503, value: '54А' },
    ];
    expect(pickAddressEntry(houses, '54', normalizeHouse, 'house').id).toBe(38502);
    expect(pickAddressEntry(houses, '54 а', normalizeHouse, 'house').id).toBe(38503);
    expect(() => pickAddressEntry([{ id: 38503, value: '54А' }], '54', normalizeHouse, 'house')).toThrow('found: 54А');
  });

  it('fails when nothing is found', () => {
    expect(() => pickAddressEntry([], '54', normalizeHouse, 'house')).toThrow('found: nothing');
  });
});
