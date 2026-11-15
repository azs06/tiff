import { addDays, addMonths, addYears, nextWeekdayOnOrAfter, weekdayOf } from './dates';

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';

export interface RecurrenceRule {
	unit: RecurrenceUnit;
	interval: number;
	/** Only for unit 'week': days of week (0 = Sunday). Sorted, unique. */
	weekdays?: number[];
}

const WEEKDAY_WORDS: Record<string, number> = {
	sunday: 0,
	sun: 0,
	monday: 1,
	mon: 1,
	tuesday: 2,
	tue: 2,
	tues: 2,
	wednesday: 3,
	wed: 3,
	thursday: 4,
	thu: 4,
	thur: 4,
	thurs: 4,
	friday: 5,
	fri: 5,
	saturday: 6,
	sat: 6
};

const SHORT_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const UNIT_WORDS: Record<string, RecurrenceUnit> = {
	day: 'day',
	days: 'day',
	week: 'week',
	weeks: 'week',
	month: 'month',
	months: 'month',
	year: 'year',
	years: 'year'
};

const ADVERBS: Record<string, RecurrenceUnit> = {
	daily: 'day',
	weekly: 'week',
	monthly: 'month',
	yearly: 'year',
	annually: 'year'
};

const MAX_INTERVAL = 365;

/**
 * Parses phrases like "every day", "daily", "every 2 weeks", "every other month",
 * "every weekday", "every mon, wed and fri", "every year".
 * Returns null when the whole phrase is not a recognised recurrence.
 */
export function parseRecurrence(input: string): RecurrenceRule | null {
	const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
	if (!text) return null;

	if (text in ADVERBS) return { unit: ADVERBS[text], interval: 1 };

	const match = /^every (.+)$/.exec(text);
	if (!match) return null;
	let rest = match[1];

	let interval = 1;
	const numeric = /^(\d+) (.+)$/.exec(rest);
	if (numeric) {
		interval = Number(numeric[1]);
		rest = numeric[2];
	} else if (rest.startsWith('other ')) {
		interval = 2;
		rest = rest.slice('other '.length);
	}
	if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) return null;

	if (rest in UNIT_WORDS) {
		const unit = UNIT_WORDS[rest];
		// "every 2 week" is fine, but "every weeks" is not.
		if (interval === 1 && rest.endsWith('s')) return null;
		return { unit, interval };
	}

	if (rest === 'weekday' || rest === 'workday') return { unit: 'week', interval, weekdays: [1, 2, 3, 4, 5] };
	if (rest === 'weekend') return { unit: 'week', interval, weekdays: [0, 6] };

	const parts = rest.split(/\s*,\s*|\s+and\s+|\s+/).filter(Boolean);
	if (parts.length === 0) return null;
	const days = new Set<number>();
	for (const part of parts) {
		if (!(part in WEEKDAY_WORDS)) return null;
		days.add(WEEKDAY_WORDS[part]);
	}
	return { unit: 'week', interval, weekdays: [...days].sort((a, b) => a - b) };
}

export function formatRecurrence(rule: RecurrenceRule): string {
	const { unit, interval, weekdays } = rule;
	if (unit === 'week' && weekdays && weekdays.length > 0) {
		const prefix = interval === 1 ? 'every' : interval === 2 ? 'every other' : `every ${interval}`;
		if (weekdays.join() === '1,2,3,4,5') return `${prefix} weekday`;
		if (weekdays.join() === '0,6') return `${prefix} weekend`;
		return `${prefix} ${weekdays.map((day) => SHORT_WEEKDAYS[day]).join(', ')}`;
	}
	if (interval === 1) return `every ${unit}`;
	if (interval === 2) return `every other ${unit}`;
	return `every ${interval} ${unit}s`;
}

/** Normalises user input into the canonical stored form, or null if invalid. */
export function normalizeRecurrence(input: string): string | null {
	const rule = parseRecurrence(input);
	return rule ? formatRecurrence(rule) : null;
}

/** First occurrence on or after `from`. */
export function firstOccurrence(rule: RecurrenceRule, from: string): string {
	if (rule.unit === 'week' && rule.weekdays?.length) {
		const candidates = rule.weekdays.map((day) => nextWeekdayOnOrAfter(from, day));
		return candidates.sort()[0];
	}
	return from;
}

/** The occurrence strictly after `from`, where `from` is the current due date. */
export function nextOccurrence(rule: RecurrenceRule, from: string): string {
	switch (rule.unit) {
		case 'day':
			return addDays(from, rule.interval);
		case 'month':
			return addMonths(from, rule.interval);
		case 'year':
			return addYears(from, rule.interval);
		case 'week': {
			if (!rule.weekdays?.length) return addDays(from, 7 * rule.interval);
			// Weeks start on Monday. Look for a later matching day in the same week first.
			const mondayIndex = (weekdayOf(from) + 6) % 7;
			for (let offset = 1; offset < 7 - mondayIndex; offset++) {
				const candidate = addDays(from, offset);
				if (rule.weekdays.includes(weekdayOf(candidate))) return candidate;
			}
			const weekStart = addDays(from, -mondayIndex + 7 * rule.interval);
			for (let offset = 0; offset < 7; offset++) {
				const candidate = addDays(weekStart, offset);
				if (rule.weekdays.includes(weekdayOf(candidate))) return candidate;
			}
			return addDays(from, 7 * rule.interval);
		}
	}
}
