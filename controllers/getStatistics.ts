import bot from '../bot';
import { formatTime, logger, sendErrorToAdmin } from '../utils';
import LightHistory from '../schemas/lightHistory.schema';

interface HistoryEntry {
  timestamp: Date;
  status: boolean;
}

type PeriodKey = 'day' | 'week' | 'month' | 'halfyear' | 'year' | 'all';

interface PeriodConfig {
  key: PeriodKey;
  label: string;
  getStart: (now: Date, firstEntryTs: Date) => Date;
}

const getPeriodConfigs = (now: Date, firstEntryTs: Date): PeriodConfig[] => [
  {
    key: 'day',
    label: 'за сьогодні',
    getStart: n => {
      const d = new Date(n);
      d.setHours(0, 0, 0, 0);
      return d;
    },
  },
  {
    key: 'week',
    label: 'за тиждень',
    getStart: n => {
      const d = new Date(n);
      const dayOfWeek = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - dayOfWeek);
      d.setHours(0, 0, 0, 0);
      return d;
    },
  },
  {
    key: 'month',
    label: 'за місяць',
    getStart: n => new Date(n.getFullYear(), n.getMonth(), 1),
  },
  {
    key: 'halfyear',
    label: 'за півроку',
    getStart: n => {
      const startMonth = n.getMonth() < 6 ? 0 : 6;
      return new Date(n.getFullYear(), startMonth, 1);
    },
  },
  {
    key: 'year',
    label: 'за рік',
    getStart: n => new Date(n.getFullYear(), 0, 1),
  },
  {
    key: 'all',
    label: 'за весь час',
    getStart: (_, first) => new Date(first),
  },
];

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
      const startDate = config.getStart(now, firstEntryTs);
      const periodMs = now.getTime() - startDate.getTime();
      if (periodMs <= 0) {
        results.push({ key: config.key, label: config.label, count: 0, offMs: 0, periodMs: 0 });
        continue;
      }

      const count = await LightHistory.countDocuments({
        timestamp: { $gte: startDate },
        status: false,
      });

      const lastBeforePeriod = await LightHistory.findOne({ timestamp: { $lt: startDate } })
        .sort({ timestamp: -1 })
        .lean();

      const periodEntries = await LightHistory.find({
        timestamp: { $gte: startDate },
      })
        .sort({ timestamp: 1 })
        .lean();

      const offMs = computeOffDuration(startDate, now, lastBeforePeriod, periodEntries);

      results.push({
        key: config.key,
        label: config.label,
        count,
        offMs,
        periodMs,
      });
    }

    const blocks: string[] = [];
    let prevCount = -1;

    for (const r of results) {
      const show = r.key === 'day' || r.count > prevCount;
      if (!show) continue;

      prevCount = r.count;

      const durationText = formatTime(r.offMs);
      const onMs = Math.max(0, r.periodMs - r.offMs);
      const onPct = r.periodMs > 0 ? Math.round((onMs / r.periodMs) * 100) : 0;
      const offPct = r.periodMs > 0 ? Math.round((r.offMs / r.periodMs) * 100) : 0;

      blocks.push(
        `*${r.label}:*\n` + `кількість - ${r.count}\n` + `тривалість - ${durationText}\n` + `🟢${onPct}% 🔴${offPct}%`,
      );
    }

    const header = '*Статистика відключень*\n';
    const message = blocks.length > 0 ? header + '\n' + blocks.join('\n\n') : 'Немає даних за сьогодні';
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
