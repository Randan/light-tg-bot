function getForm(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = count % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function formatUnit(count: number, one: string, few: string, many: string): string {
  return `${count} ${getForm(count, one, few, many)}`;
}

export function formatTime(deltaMs: number): string {
  const seconds = Math.floor(deltaMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(months / 12);

  if (years > 0) {
    const remainingMonths = months % 12;
    if (remainingMonths > 0) {
      return `${formatUnit(years, 'рік', 'роки', 'років')} ${formatUnit(remainingMonths, 'місяць', 'місяці', 'місяців')}`;
    }
    return formatUnit(years, 'рік', 'роки', 'років');
  }
  if (months > 0) {
    const remainingDays = days % 30;
    if (remainingDays > 0) {
      return `${formatUnit(months, 'місяць', 'місяці', 'місяців')} ${formatUnit(remainingDays, 'день', 'дні', 'днів')}`;
    }
    return formatUnit(months, 'місяць', 'місяці', 'місяців');
  }
  if (days > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${formatUnit(days, 'день', 'дні', 'днів')} ${formatUnit(remainingHours, 'година', 'години', 'годин')}`;
    }
    return formatUnit(days, 'день', 'дні', 'днів');
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${formatUnit(hours, 'година', 'години', 'годин')} ${formatUnit(remainingMinutes, 'хвилина', 'хвилини', 'хвилин')}`;
    }
    return formatUnit(hours, 'година', 'години', 'годин');
  }
  if (minutes > 0) {
    return formatUnit(minutes, 'хвилина', 'хвилини', 'хвилин');
  }
  return 'менше хвилини';
}
