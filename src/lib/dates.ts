// Calendar-date helpers. Due dates are "floating" local dates stored as YYYY-MM-DD,
// and times as HH:MM. All arithmetic runs on UTC midnights so no DST shifts apply.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

export function isValidDate(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const match = DATE_RE.exec(value);
	if (!match) return false;
	const [, y, m, d] = match.map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isValidTime(value: unknown): value is string {
	return typeof value === 'string' && TIME_RE.test(value);
}

export function isValidTimeZone(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

function toUtc(date: string): Date {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(date: Date): string {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, '0');
	const d = String(date.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export function makeDate(year: number, month: number, day: number): string | null {
	const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
	return isValidDate(value) ? value : null;
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: isValidTimeZone(timeZone) ? timeZone : 'UTC',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(now);
	const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: string, days: number): string {
	const value = toUtc(date);
	value.setUTCDate(value.getUTCDate() + days);
	return fromUtc(value);
}

function daysInMonth(year: number, monthIndex: number): number {
	return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Adds months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number): string {
	const value = toUtc(date);
	const day = value.getUTCDate();
	const target = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
	target.setUTCDate(Math.min(day, daysInMonth(target.getUTCFullYear(), target.getUTCMonth())));
	return fromUtc(target);
}

export function addYears(date: string, years: number): string {
	return addMonths(date, years * 12);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekdayOf(date: string): number {
	return toUtc(date).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
	return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** First date on or after `from` that falls on `weekday`. */
export function nextWeekdayOnOrAfter(from: string, weekday: number): string {
	const diff = (weekday - weekdayOf(from) + 7) % 7;
	return addDays(from, diff);
}

export type DueStatus = 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later';

export function dueStatus(date: string, today: string): DueStatus {
	const diff = daysBetween(today, date);
	if (diff < 0) return 'overdue';
	if (diff === 0) return 'today';
	if (diff === 1) return 'tomorrow';
	if (diff < 7) return 'soon';
	return 'later';
}

export function formatTime(time: string): string {
	const [h, m] = time.split(':').map(Number);
	const suffix = h >= 12 ? 'PM' : 'AM';
	const hour = h % 12 === 0 ? 12 : h % 12;
	return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatDate(date: string, today: string): string {
	const diff = daysBetween(today, date);
	if (diff === 0) return 'Today';
	if (diff === 1) return 'Tomorrow';
	if (diff === -1) return 'Yesterday';
	const value = toUtc(date);
	const weekday = WEEKDAY_NAMES[value.getUTCDay()];
	if (diff > 1 && diff < 7) return weekday;
	const month = MONTH_NAMES[value.getUTCMonth()].slice(0, 3);
	const base = `${weekday.slice(0, 3)} ${value.getUTCDate()} ${month}`;
	return value.getUTCFullYear() === toUtc(today).getUTCFullYear()
		? base
		: `${base} ${value.getUTCFullYear()}`;
}

export function formatDue(date: string, time: string | null, today: string): string {
	return time ? `${formatDate(date, today)} ${formatTime(time)}` : formatDate(date, today);
}

/** Long heading, e.g. "Tue 17 Nov · Tomorrow". */
export function formatDayHeading(date: string, today: string): string {
	const value = toUtc(date);
	const base = `${WEEKDAY_NAMES[value.getUTCDay()].slice(0, 3)} ${value.getUTCDate()} ${MONTH_NAMES[value.getUTCMonth()].slice(0, 3)}`;
	const diff = daysBetween(today, date);
	if (diff === 0) return `${base} · Today`;
	if (diff === 1) return `${base} · Tomorrow`;
	return `${base} · ${WEEKDAY_NAMES[value.getUTCDay()]}`;
}

export function dateFromTimestamp(timestamp: number, timeZone: string): string {
	return todayInTimeZone(timeZone, new Date(timestamp));
}
