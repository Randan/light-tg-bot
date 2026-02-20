import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LightHistoryDoc } from './schemas/light-history.schema';
import { formatTime } from './format-time.util';
import { LoggerService } from '../common/logger/logger.service';

type PeriodKey =
  | 'day'
  | 'week_current'
  | 'week_prev'
  | 'month_current'
  | 'month_prev'
  | 'year_current'
  | 'year_prev'
  | 'all';

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
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayOfYear(now: Date): number {
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

interface HistoryEntry {
  timestamp: Date;
  status: boolean;
}

function computeOffDuration(
  startDate: Date,
  endDate: Date,
  lastBeforePeriod: HistoryEntry | null,
  periodEntries: HistoryEntry[],
): number {
  let totalOffMs = 0;
  let offStartedAt: Date | null = null;
  if (lastBeforePeriod?.status === false) offStartedAt = startDate;
  periodEntries.forEach((entry) => {
    if (entry.status === false) {
      if (!offStartedAt) offStartedAt = new Date(entry.timestamp);
      return;
    }
    if (offStartedAt) {
      totalOffMs += new Date(entry.timestamp).getTime() - offStartedAt.getTime();
      offStartedAt = null;
    }
  });
  if (offStartedAt) totalOffMs += endDate.getTime() - offStartedAt.getTime();
  return totalOffMs;
}

@Injectable()
export class LightStatisticsService {
  constructor(
    @InjectModel(LightHistoryDoc.name)
    private readonly lightHistoryModel: Model<LightHistoryDoc>,
    private readonly logger: LoggerService,
  ) {}

  async getStatisticsMessage(): Promise<string> {
    const now = new Date();
    const firstEntry = await this.lightHistoryModel
      .findOne()
      .sort({ timestamp: 1 })
      .lean()
      .exec();
    const firstEntryTs = firstEntry ? new Date(firstEntry.timestamp) : now;

    const weekStart = startOfThisWeek(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);

    const configs: {
      key: PeriodKey;
      getStart: (n: Date, f: Date) => Date;
      getEnd: (n: Date) => Date;
      endInclusive: boolean;
      getLabel: (n: Date, s: Date) => string;
      shouldShow: (n: Date, f: Date) => boolean;
    }[] = [
      {
        key: 'day',
        getStart: (n) => {
          const d = new Date(n);
          d.setHours(0, 0, 0, 0);
          return d;
        },
        getEnd: (n) => new Date(n),
        endInclusive: true,
        getLabel: () => 'за сьогодні',
        shouldShow: () => true,
      },
      {
        key: 'week_current',
        getStart: () => new Date(weekStart),
        getEnd: (n) => new Date(n),
        endInclusive: true,
        getLabel: (n) => {
          const daysPassed = ((n.getDay() + 6) % 7) + 1;
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
        getEnd: (n) => new Date(n),
        endInclusive: true,
        getLabel: (n) => `цей місяць (${formatDays(n.getDate())})`,
        shouldShow: (n) => n.getDate() >= 7,
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
        getEnd: (n) => new Date(n),
        endInclusive: true,
        getLabel: (n) => `цей рік (${formatDays(dayOfYear(n))})`,
        shouldShow: (n) => dayOfYear(n) >= 7,
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
        getEnd: (n) => new Date(n),
        endInclusive: true,
        getLabel: () => 'за весь час',
        shouldShow: () => true,
      },
    ];

    const results: { key: PeriodKey; label: string; count: number; offMs: number; periodMs: number }[] = [];

    for (const config of configs) {
      if (!config.shouldShow(now, firstEntryTs)) continue;
      const startDate = config.getStart(now, firstEntryTs);
      const endDate = config.getEnd(now);
      const periodMs = endDate.getTime() - startDate.getTime();
      if (periodMs <= 0) continue;
      const endQuery = config.endInclusive ? { $lte: endDate } : { $lt: endDate };
      const count = await this.lightHistoryModel.countDocuments({
        timestamp: { $gte: startDate, ...endQuery },
        status: false,
      });
      const lastBeforePeriod = await this.lightHistoryModel
        .findOne({ timestamp: { $lt: startDate } })
        .sort({ timestamp: -1 })
        .lean()
        .exec();
      const periodEntries = await this.lightHistoryModel
        .find({ timestamp: { $gte: startDate, ...endQuery } })
        .sort({ timestamp: 1 })
        .lean()
        .exec();
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

    const currentKeys: PeriodKey[] = ['day', 'week_current', 'month_current', 'year_current'];
    const previousKeys: PeriodKey[] = ['week_prev', 'month_prev', 'year_prev'];
    const byKey = new Map(results.map((r) => [r.key, r]));

    const block1Rows: string[] = [];
    for (const key of currentKeys) {
      const r = byKey.get(key);
      if (!r) continue;
      const durationText = formatTime(r.offMs);
      const onMs = Math.max(0, r.periodMs - r.offMs);
      const onPct = r.periodMs > 0 ? Math.round((onMs / r.periodMs) * 100) : 0;
      const offPct = r.periodMs > 0 ? Math.round((r.offMs / r.periodMs) * 100) : 0;
      block1Rows.push(
        `*${r.label}:*\nкількість - ${r.count}\nтривалість - ${durationText}\n🟢${onPct}% 🔴${offPct}%`,
      );
    }
    const block2Rows: string[] = [];
    for (const key of previousKeys) {
      const r = byKey.get(key);
      if (!r) continue;
      const durationText = formatTime(r.offMs);
      const onMs = Math.max(0, r.periodMs - r.offMs);
      const onPct = r.periodMs > 0 ? Math.round((onMs / r.periodMs) * 100) : 0;
      const offPct = r.periodMs > 0 ? Math.round((r.offMs / r.periodMs) * 100) : 0;
      block2Rows.push(
        `*${r.label}:*\nкількість - ${r.count}\nтривалість - ${durationText}\n🟢${onPct}% 🔴${offPct}%`,
      );
    }
    const allResult = byKey.get('all');
    let allRow = '';
    if (allResult) {
      const durationText = formatTime(allResult.offMs);
      const onMs = Math.max(0, allResult.periodMs - allResult.offMs);
      const onPct =
        allResult.periodMs > 0
          ? Math.round((onMs / allResult.periodMs) * 100)
          : 0;
      const offPct =
        allResult.periodMs > 0
          ? Math.round((allResult.offMs / allResult.periodMs) * 100)
          : 0;
      allRow = `*${allResult.label}:*\nкількість - ${allResult.count}\nтривалість - ${durationText}\n🟢${onPct}% 🔴${offPct}%`;
    }

    const parts: string[] = ['*Статистика відключень*\n'];
    if (block1Rows.length > 0) parts.push('*Поточні періоди:*\n', block1Rows.join('\n\n'));
    if (block2Rows.length > 0) {
      if (parts.length > 1) parts.push('');
      parts.push('*Минулі періоди:*\n', block2Rows.join('\n\n'));
    }
    if (allRow) {
      if (parts.length > 1) parts.push('');
      parts.push(allRow);
    }
    return parts.length > 1 ? parts.join('\n') : 'Немає даних за сьогодні';
  }
}
