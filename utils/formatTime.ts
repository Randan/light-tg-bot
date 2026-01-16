const getForm = (count: number, one: string, few: string, many: string): string => {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }

  const mod10 = count % 10;
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
};

const formatUnit = (count: number, one: string, few: string, many: string): string =>
  `${count} ${getForm(count, one, few, many)}`;

const formatTime = (delta: number): string => {
  const seconds = Math.floor(delta / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(months / 12);

  if (years > 0) {
    const remainingMonths = months % 12;
    if (remainingMonths > 0) {
      return `${formatUnit(years, 'року', 'роки', 'років')} ${formatUnit(
        remainingMonths,
        'місяця',
        'місяці',
        'місяців',
      )}`;
    }
    return formatUnit(years, 'року', 'роки', 'років');
  }

  if (months > 0) {
    const remainingDays = days % 30;
    if (remainingDays > 0) {
      return `${formatUnit(months, 'місяця', 'місяці', 'місяців')} ${formatUnit(remainingDays, 'дня', 'дні', 'днів')}`;
    }
    return formatUnit(months, 'місяця', 'місяці', 'місяців');
  }

  if (days > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${formatUnit(days, 'дня', 'дні', 'днів')} ${formatUnit(remainingHours, 'години', 'години', 'годин')}`;
    }
    return formatUnit(days, 'дня', 'дні', 'днів');
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${formatUnit(hours, 'години', 'години', 'годин')} ${formatUnit(
        remainingMinutes,
        'хвилини',
        'хвилини',
        'хвилин',
      )}`;
    }
    return formatUnit(hours, 'години', 'години', 'годин');
  }

  if (minutes > 0) {
    return formatUnit(minutes, 'хвилини', 'хвилини', 'хвилин');
  }

  return 'менше хвилини';
};

export default formatTime;
