import { Moon, Pencil, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { TimelineItem } from '../types';
import { CardShell } from './checkin-card/CardShell';
import { normalizeTimezoneForDisplay } from '../utils/checkin';

interface SleepCardProps {
  item: TimelineItem;
}

function formatDuration(startedAt: string, endedAt: string): string {
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  const diffMs = Math.max(0, endMs - startMs);
  const totalMinutes = Math.round(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function renderStars(rating: number): string {
  const clamped = Math.max(0, Math.min(5, rating));
  const full = Math.floor(clamped);
  const half = clamped - full >= 0.5;
  return `${'★'.repeat(full)}${half ? '½' : ''}`;
}

function getTimezoneAbbreviation(dateTime: string, timezone: string): string {
  const displayTimezone = normalizeTimezoneForDisplay(timezone) || timezone;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: displayTimezone,
      timeZoneName: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
    const parts = formatter.formatToParts(new Date(dateTime));
    return parts.find((part) => part.type === 'timeZoneName')?.value || timezone;
  } catch {
    return timezone;
  }
}

function formatClockTime(dateTime: string, timezone: string): string {
  const displayTimezone = normalizeTimezoneForDisplay(timezone) || timezone;

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: displayTimezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(dateTime));
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(dateTime));
  }
}

function formatTimeWithShortDate(dateTime: string, timezone: string): string {
  const displayTimezone = normalizeTimezoneForDisplay(timezone) || timezone;
  const date = new Date(dateTime);

  try {
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: displayTimezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
    const shortDate = new Intl.DateTimeFormat('en-US', {
      timeZone: displayTimezone,
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    return `${time} ${shortDate}`;
  } catch {
    const time = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
    const shortDate = new Intl.DateTimeFormat('en-US', {
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    return `${time} ${shortDate}`;
  }
}

export default function SleepCard({ item }: SleepCardProps) {
  const startedAt = item.sleep_started_at || item.checked_in_at;
  const endedAt = item.sleep_ended_at || item.checked_in_at;
  const timezone = item.sleep_timezone || 'UTC';
  const timezoneLabel = getTimezoneAbbreviation(startedAt, timezone);
  const rating = Number(item.sleep_rating || 0);

  return (
    <CardShell>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Moon size={16} className="text-indigo-500 shrink-0" />
            <span className="text-base font-semibold text-indigo-700 dark:text-indigo-300">Slept for {formatDuration(startedAt, endedAt)}</span>
          </div>

          {rating > 0 && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/30 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <Star size={12} className="fill-current" />
              {renderStars(rating)}
              <span className="text-[11px] text-amber-600/80 dark:text-amber-300/80">({rating.toFixed(1)})</span>
            </div>
          )}

          {item.sleep_comment && (
            <p className="mt-2 text-xs italic text-gray-500 dark:text-gray-400">
              {item.sleep_comment}
            </p>
          )}

          <div className="mt-2 flex items-center justify-start gap-1 text-sm text-gray-700 dark:text-gray-300">
            <Link
              to={`/sleep-entries/${item.id}`}
              className="text-xs hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
            >
              {formatClockTime(startedAt, timezone)} - {endedAt && formatTimeWithShortDate(endedAt, timezone)}
            </Link>

            <span className="inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
              {timezoneLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Link
            to={`/sleep-check-in?edit=${item.id}`}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors"
            title="Edit"
          >
            <Pencil size={14} />
          </Link>
        </div>
      </div>
    </CardShell>
  );
}
