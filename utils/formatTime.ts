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
      return `${years} ${years === 1 ? 'рік' : years < 5 ? 'роки' : 'років'} ${remainingMonths} ${remainingMonths === 1 ? 'місяць' : remainingMonths < 5 ? 'місяці' : 'місяців'}`;
    }
    return `${years} ${years === 1 ? 'рік' : years < 5 ? 'роки' : 'років'}`;
  }

  if (months > 0) {
    const remainingDays = days % 30;
    if (remainingDays > 0) {
      return `${months} ${months === 1 ? 'місяць' : months < 5 ? 'місяці' : 'місяців'} ${remainingDays} ${remainingDays === 1 ? 'день' : remainingDays < 5 ? 'дні' : 'днів'}`;
    }
    return `${months} ${months === 1 ? 'місяць' : months < 5 ? 'місяці' : 'місяців'}`;
  }

  if (days > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${days} ${days === 1 ? 'день' : days < 5 ? 'дні' : 'днів'} ${remainingHours} ${remainingHours === 1 ? 'година' : remainingHours < 5 ? 'години' : 'годин'}`;
    }
    return `${days} ${days === 1 ? 'день' : days < 5 ? 'дні' : 'днів'}`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours} ${hours === 1 ? 'година' : hours < 5 ? 'години' : 'годин'} ${remainingMinutes} ${remainingMinutes === 1 ? 'хвилина' : remainingMinutes < 5 ? 'хвилини' : 'хвилин'}`;
    }
    return `${hours} ${hours === 1 ? 'година' : hours < 5 ? 'години' : 'годин'}`;
  }

  if (minutes > 0) {
    return `${minutes} ${minutes === 1 ? 'хвилина' : minutes < 5 ? 'хвилини' : 'хвилин'}`;
  }

  return 'менше хвилини';
};

export default formatTime;
