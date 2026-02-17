import bot from '../bot';
import { formatTime, logger, sendErrorToAdmin } from '../utils';
import LightHistory from '../schemas/lightHistory.schema';

interface HistoryEntry {
  timestamp: Date;
  status: boolean;
}

type PeriodKey =
  | 'day'
  | 'week_current'
  | 'week_prev'
  | 'month_current'
  | 'month_prev'
  | 'year_current'
  | 'year_prev'
  | 'all';

const CURRENT_BLOCK_KEYS: PeriodKey[] = ['day', 'week_current', 'month_current', 'year_current'];
const PREVIOUS_BLOCK_KEYS: PeriodKey[] = ['week_prev', 'month_prev', 'year_prev'];

function formatDays(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} днів`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} дні`;
  return `${n} днів`;
}

function startOfThisWeek(now: Date): Date {
  const d = new Date(now);
  const dayOfWeek = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayOfWeek);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfThisMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function startOfThisYear(now: Date): Date {
  return new Date(now.getFullYear(), 0, 1);
}

function dayOfYear(now: Date): number {
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

interface PeriodConfig {
  key: PeriodKey;
  getStart: (now: Date, firstEntryTs: Date) => Date;
  getEnd: (now: Date) => Date;
  endInclusive: boolean;
  getLabel: (now: Date, startDate: Date) => string;
  shouldShow: (now: Date, firstEntryTs: Date) => boolean;
}

function getPeriodConfigs(now: Date, firstEntryTs: Date): PeriodConfig[] {
  const weekStart = startOfThisWeek(now);
  const monthStart = startOfThisMonth(now);
  const yearStart = startOfThisYear(now);

  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);

  return [
    {
      key: 'day',
      getStart: n => {
        const d = new Date(n);
        d.setHours(0, 0, 0, 0);
        return d;
      },
      getEnd: n => new Date(n),
      endInclusive: true,
      getLabel: () => 'за сьогодні',
      shouldShow: () => true,
    },
    {
      key: 'week_current',
      getStart: () => new Date(weekStart),
      getEnd: n => new Date(n),
      endInclusive: true,
      getLabel: n => {
        const dayIndex = (n.getDay() + 6) % 7;
        const daysPassed = dayIndex + 1;
        return `цей тиждень (${formatDays(daysPassed)})`;
      },
      shouldShow: () => true,
    },
    {
      key: 'week_prev',
      getStart: () => new Date(lastWeekStart),
      getEnd: () => new Date(weekStart),
      endInclusive: false,
      getLabel: () => 'минулий тиждень',
      shouldShow: (_, first) => first.getTime() < weekStart.getTime(),
    },
    {
      key: 'month_current',
      getStart: () => new Date(monthStart),
      getEnd: n => new Date(n),
      endInclusive: true,
      getLabel: n => `цей місяць (${formatDays(n.getDate())})`,
      shouldShow: n => n.getDate() >= 7,
    },
    {
      key: 'month_prev',
      getStart: () => new Date(lastMonthStart),
      getEnd: () => new Date(monthStart),
      endInclusive: false,
      getLabel: () => 'минулий місяць',
      shouldShow: (_, first) => first.getTime() < monthStart.getTime(),
    },
    {
      key: 'year_current',
      getStart: () => new Date(yearStart),
      getEnd: n => new Date(n),
      endInclusive: true,
      getLabel: n => `цей рік (${formatDays(dayOfYear(n))})`,
      shouldShow: n => dayOfYear(n) >= 7,
    },
    {
      key: 'year_prev',
      getStart: () => new Date(lastYearStart),
      getEnd: () => new Date(yearStart),
      endInclusive: false,
      getLabel: () => 'минулий рік',
      shouldShow: (_, first) => first.getTime() < yearStart.getTime(),
    },
    {
      key: 'all',
      getStart: (_, first) => new Date(first),
      getEnd: n => new Date(n),
      endInclusive: true,
      getLabel: () => 'за весь час',
      shouldShow: () => true,
    },
  ];
}

function computeOffDuration(
  startDate: Date,
  endDate: Date,
  lastBeforePeriod: HistoryEntry | null,
  periodEntries: HistoryEntry[],
): number {
  let totalOffMs = 0;
  let offStartedAt: Date | null = null;

  if (lastBeforePeriod?.status === false) {
    offStartedAt = startDate;
  }

  periodEntries.forEach(entry => {
    if (entry.status === false) {
      if (!offStartedAt) {
        offStartedAt = new Date(entry.timestamp);
      }
      return;
    }
    if (offStartedAt) {
      totalOffMs += new Date(entry.timestamp).getTime() - offStartedAt.getTime();
      offStartedAt = null;
    }
  });

  if (offStartedAt) {
    totalOffMs += endDate.getTime() - offStartedAt.getTime();
  }

  return totalOffMs;
}

function filterByCountAndPrev(results: { key: PeriodKey; count: number }[], keys: PeriodKey[]) {
  const byKey = new Map(results.map(r => [r.key, r]));
  const filtered: typeof results = [];
  let prevCount = -1;
  for (const key of keys) {
    const r = byKey.get(key);
    if (!r) continue;
    const isFirst = filtered.length === 0;
    if (isFirst || r.count > prevCount) {
      filtered.push(r);
      prevCount = r.count;
    }
  }
  return filtered;
}

const getStatistics = async (id: number): Promise<void> => {
  try {
    if (!id) {
      logger.error('User id is required');
      return;
    }

    const now = new Date();

    const firstEntry = await LightHistory.findOne().sort({ timestamp: 1 }).lean();
    const firstEntryTs = firstEntry ? new Date(firstEntry.timestamp) : now;

    const configs = getPeriodConfigs(now, firstEntryTs);

    type PeriodResult = {
      key: PeriodKey;
      label: string;
      count: number;
      offMs: number;
      periodMs: number;
    };

    const results: PeriodResult[] = [];

    for (const config of configs) {
      if (!config.shouldShow(now, firstEntryTs)) continue;

      const startDate = config.getStart(now, firstEntryTs);
      const endDate = config.getEnd(now);
      const periodMs = endDate.getTime() - startDate.getTime();
      if (periodMs <= 0) continue;

      const endQuery = config.endInclusive ? { $lte: endDate } : { $lt: endDate };
      const count = await LightHistory.countDocuments({
        timestamp: { $gte: startDate, ...endQuery },
        status: false,
      });

      const lastBeforePeriod = await LightHistory.findOne({ timestamp: { $lt: startDate } })
        .sort({ timestamp: -1 })
        .lean();

      const periodEntries = await LightHistory.find({
        timestamp: { $gte: startDate, ...endQuery },
      })
        .sort({ timestamp: 1 })
        .lean();

      const offMs = computeOffDuration(
        startDate,
        endDate,
        lastBeforePeriod as HistoryEntry | null,
        periodEntries as HistoryEntry[],
      );

      results.push({
        key: config.key,
        label: config.getLabel(now, startDate),
        count,
        offMs,
        periodMs,
      });
    }

    const currentFiltered = filterByCountAndPrev(
      results.map(r => ({ key: r.key, count: r.count })),
      CURRENT_BLOCK_KEYS,
    );
    const previousFiltered = filterByCountAndPrev(
      results.map(r => ({ key: r.key, count: r.count })),
      PREVIOUS_BLOCK_KEYS,
    );

    const resultByKey = new Map(results.map(r => [r.key, r]));

    const block1Rows: string[] = [];
    for (const { key } of currentFiltered) {
      const r = resultByKey.get(key)!;
      const durationText = formatTime(r.offMs);
      const onMs = Math.max(0, r.periodMs - r.offMs);
      const onPct = r.periodMs > 0 ? Math.round((onMs / r.periodMs) * 100) : 0;
      const offPct = r.periodMs > 0 ? Math.round((r.offMs / r.periodMs) * 100) : 0;
      block1Rows.push(
        `*${r.label}:*\n` + `кількість - ${r.count}\n` + `тривалість - ${durationText}\n` + `🟢${onPct}% 🔴${offPct}%`,
      );
    }

    const block2Rows: string[] = [];
    for (const { key } of previousFiltered) {
      const r = resultByKey.get(key)!;
      const durationText = formatTime(r.offMs);
      const onMs = Math.max(0, r.periodMs - r.offMs);
      const onPct = r.periodMs > 0 ? Math.round((onMs / r.periodMs) * 100) : 0;
      const offPct = r.periodMs > 0 ? Math.round((r.offMs / r.periodMs) * 100) : 0;
      block2Rows.push(
        `*${r.label}:*\n` + `кількість - ${r.count}\n` + `тривалість - ${durationText}\n` + `🟢${onPct}% 🔴${offPct}%`,
      );
    }

    const allResult = resultByKey.get('all');
    const allRow =
      allResult &&
      (previousFiltered.length === 0 || allResult.count > previousFiltered[previousFiltered.length - 1].count)
        ? (() => {
            const r = allResult;
            const durationText = formatTime(r.offMs);
            const onMs = Math.max(0, r.periodMs - r.offMs);
            const onPct = r.periodMs > 0 ? Math.round((onMs / r.periodMs) * 100) : 0;
            const offPct = r.periodMs > 0 ? Math.round((r.offMs / r.periodMs) * 100) : 0;
            return (
              `*${r.label}:*\n` +
              `кількість - ${r.count}\n` +
              `тривалість - ${durationText}\n` +
              `🟢${onPct}% 🔴${offPct}%`
            );
          })()
        : null;

    const parts: string[] = ['*Статистика відключень*\n'];
    if (block1Rows.length > 0) {
      parts.push('*Поточні періоди:*\n', block1Rows.join('\n\n'));
    }
    if (block2Rows.length > 0) {
      if (parts.length > 1) parts.push('');
      parts.push('*Минулі періоди:*\n', block2Rows.join('\n\n'));
    }
    if (allRow) {
      if (parts.length > 1) parts.push('');
      parts.push(allRow);
    }

    const message = parts.length > 1 ? parts.join('\n') : 'Немає даних за сьогодні';
    bot.sendMessage(id, message, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error('Failed to get statistics', err);
    bot.sendMessage(id, 'Помилка при отриманні статистики');
    await sendErrorToAdmin(err, {
      location: 'getStatistics',
      userId: id,
      additionalInfo: 'Failed to get statistics',
    });
  }
};

export default getStatistics;
