export interface YasnoAddressEntry {
  id: number;
  value: string;
}

/** Street type prefixes YASNO puts in front of the name: "вул. Тираспольська". */
const STREET_PREFIX =
  /^(вул|вулиця|просп|проспект|пров|провулок|бульв|бульвар|пл|площа|наб|набережна|узв|узвіз|туп|тупик|шосе|алея|майдан)\.?\s+/i;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’'ʼ`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeStreet(value: string): string {
  return normalize(value).replace(STREET_PREFIX, '');
}

export function normalizeHouse(value: string): string {
  return normalize(value).replace(/\s/g, '');
}

/**
 * The entry whose name matches exactly after normalization. Anything else is
 * an error, never a guess: the search also returns "54А" for "54".
 */
export function pickAddressEntry(
  entries: YasnoAddressEntry[],
  wanted: string,
  normalizeFn: (value: string) => string,
  what: string,
): YasnoAddressEntry {
  const target = normalizeFn(wanted);
  const exact = entries.filter(entry => normalizeFn(entry.value) === target);
  if (exact.length === 1) {
    return exact[0];
  }
  const found = entries.map(entry => entry.value).join(', ') || 'nothing';
  throw new Error(`YASNO ${what} "${wanted}" is ambiguous or missing, found: ${found}`);
}
