// Natural-language quick add parser, shared by the browser (live preview),
// the form actions and the MCP tools.
//
// Supported syntax (case-insensitive):
//   #Project        project by name (multi-word names work when the project exists)
//   @label          label, repeatable
//   p1..p4          priority (p1 = highest)
//   dates           today, tod, tonight, tomorrow, tmr, next week, next month, weekend,
//                   monday / next fri, in 3 days, in 2 weeks, jan 5, 5 jan 2027, 2027-01-05
//   times           5pm, 5:30 pm, at 17:00, noon, midnight
//   recurrence      every day, daily, every 2 weeks, every other month, every weekday,
//                   every mon, wed and fri, every year

import { addDays, addMonths, addYears, makeDate, nextWeekdayOnOrAfter } from './dates';
import { firstOccurrence, formatRecurrence, parseRecurrence } from './recurrence';
import type { Priority } from './types';

export type QuickAddTokenKind = 'project' | 'label' | 'priority' | 'date' | 'time' | 'recurrence';

export interface QuickAddToken {
	start: number;
	end: number;
	kind: QuickAddTokenKind;
	text: string;
}

export interface QuickAddResult {
	title: string;
	projectId: string | null;
	projectName: string | null;
	/** Set when `#word` did not match an existing project. The text stays in the title. */
	unknownProject: string | null;
	labels: string[];
	priority: Priority | null;
	dueDate: string | null;
	dueTime: string | null;
	recurrence: string | null;
	tokens: QuickAddToken[];
}

export interface QuickAddProject {
	id: string;
	name: string;
}

const START = '(?<=^|\\s)';
const END = '(?=$|\\s|[,.;!?])';
const PREFIX = '(?:(?:on|due|by)\\s+)?';

const MONTHS: Record<string, number> = {
	jan: 1,
	january: 1,
	feb: 2,
	february: 2,
	mar: 3,
	march: 3,
	apr: 4,
	april: 4,
	may: 5,
	jun: 6,
	june: 6,
	jul: 7,
	july: 7,
	aug: 8,
	august: 8,
	sep: 9,
	sept: 9,
	september: 9,
	oct: 10,
	october: 10,
	nov: 11,
	november: 11,
	dec: 12,
	december: 12
};
const MONTH_PATTERN = Object.keys(MONTHS)
	.sort((a, b) => b.length - a.length)
	.join('|');

// Ambiguous short forms (sat, sun, wed) are left out on purpose: "buy sun cream".
const DATE_WEEKDAYS: Record<string, number> = {
	sunday: 0,
	monday: 1,
	mon: 1,
	tuesday: 2,
	tue: 2,
	tues: 2,
	wednesday: 3,
	thursday: 4,
	thu: 4,
	thur: 4,
	thurs: 4,
	friday: 5,
	fri: 5,
	saturday: 6
};
const WEEKDAY_PATTERN = Object.keys(DATE_WEEKDAYS)
	.sort((a, b) => b.length - a.length)
	.join('|');

type DateMatcher = { re: RegExp; resolve: (m: RegExpExecArray, today: string) => string | null };

function re(body: string): RegExp {
	return new RegExp(`${START}${body}${END}`, 'iu');
}

function amountWord(word: string): number {
	const lower = word.toLowerCase();
	if (lower === 'a' || lower === 'an' || lower === 'one') return 1;
	return Number(lower);
}

function resolveMonthDay(month: number, day: number, year: string | undefined, today: string): string | null {
	const todayYear = Number(today.slice(0, 4));
	if (year) return makeDate(Number(year), month, day);
	const candidate = makeDate(todayYear, month, day);
	if (!candidate) return null;
	return candidate < today ? makeDate(todayYear + 1, month, day) : candidate;
}

const DATE_MATCHERS: DateMatcher[] = [
	{ re: re(`(\\d{4}-\\d{2}-\\d{2})`), resolve: (m) => makeDate(...(m[1].split('-').map(Number) as [number, number, number])) },
	{ re: re(`${PREFIX}(?:today|tod|tonight)`), resolve: (_m, today) => today },
	{ re: re(`${PREFIX}(?:tomorrow|tmrw|tmr)`), resolve: (_m, today) => addDays(today, 1) },
	{ re: re(`${PREFIX}next\\s+week`), resolve: (_m, today) => nextWeekdayOnOrAfter(addDays(today, 1), 1) },
	{
		re: re(`${PREFIX}next\\s+month`),
		resolve: (_m, today) => addMonths(today.slice(0, 8) + '01', 1)
	},
	{ re: re(`${PREFIX}(?:this\\s+)?weekend`), resolve: (_m, today) => nextWeekdayOnOrAfter(today, 6) },
	{
		re: re(`in\\s+(a|an|one|\\d{1,3})\\s+(days?|weeks?|months?|years?)`),
		resolve: (m, today) => {
			const amount = amountWord(m[1]);
			const unit = m[2].toLowerCase().replace(/s$/, '');
			if (!Number.isFinite(amount) || amount < 0) return null;
			if (unit === 'day') return addDays(today, amount);
			if (unit === 'week') return addDays(today, amount * 7);
			if (unit === 'month') return addMonths(today, amount);
			return addYears(today, amount);
		}
	},
	{
		re: re(`${PREFIX}(next\\s+|this\\s+)?(${WEEKDAY_PATTERN})`),
		resolve: (m, today) => {
			const weekday = DATE_WEEKDAYS[m[2].toLowerCase()];
			const isNext = Boolean(m[1]?.toLowerCase().startsWith('next'));
			return nextWeekdayOnOrAfter(isNext ? addDays(today, 1) : today, weekday);
		}
	},
	{
		re: re(`${PREFIX}(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`),
		resolve: (m, today) => resolveMonthDay(MONTHS[m[1].toLowerCase()], Number(m[2]), m[3], today)
	},
	{
		re: re(`${PREFIX}(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\.?(?:,?\\s+(\\d{4}))?`),
		resolve: (m, today) => resolveMonthDay(MONTHS[m[2].toLowerCase()], Number(m[1]), m[3], today)
	}
];

type TimeMatcher = { re: RegExp; resolve: (m: RegExpExecArray) => string | null };

function hhmm(hour: number, minute: number): string | null {
	if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
	return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

const TIME_MATCHERS: TimeMatcher[] = [
	{
		re: re(`(?:at\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s?(am|pm|a\\.m\\.|p\\.m\\.)`),
		resolve: (m) => {
			const hour = Number(m[1]);
			const minute = m[2] ? Number(m[2]) : 0;
			if (hour < 1 || hour > 12) return null;
			const pm = m[3].toLowerCase().startsWith('p');
			return hhmm((hour % 12) + (pm ? 12 : 0), minute);
		}
	},
	{ re: re(`(?:at\\s+)?([01]?\\d|2[0-3]):([0-5]\\d)`), resolve: (m) => hhmm(Number(m[1]), Number(m[2])) },
	{ re: re(`(?:at\\s+)?(noon|midday)`), resolve: () => '12:00' },
	{ re: re(`(?:at\\s+)?midnight`), resolve: () => '00:00' }
];

const RECURRENCE_START = new RegExp(`${START}(every|daily|weekly|monthly|yearly|annually)(?=$|\\s|,)`, 'giu');

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class Masked {
	text: string;
	tokens: QuickAddToken[] = [];

	constructor(private readonly original: string) {
		this.text = original;
	}

	take(start: number, end: number, kind: QuickAddTokenKind) {
		this.tokens.push({ start, end, kind, text: this.original.slice(start, end) });
		this.text = this.text.slice(0, start) + ' '.repeat(end - start) + this.text.slice(end);
	}

	rest(): string {
		return this.text.replace(/\s+/g, ' ').trim();
	}
}

function takeRecurrence(masked: Masked): string | null {
	RECURRENCE_START.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = RECURRENCE_START.exec(masked.text))) {
		const start = match.index;
		const words = [...masked.text.slice(start).matchAll(/\S+/g)].slice(0, 8);
		for (let count = words.length; count >= 1; count--) {
			const last = words[count - 1];
			const end = start + (last.index ?? 0) + last[0].length;
			const phrase = masked.text.slice(start, end).replace(/[.;!?]+$/, '');
			const rule = parseRecurrence(phrase);
			if (rule) {
				masked.take(start, start + phrase.length, 'recurrence');
				return formatRecurrence(rule);
			}
		}
	}
	return null;
}

function takeDate(masked: Masked, today: string): string | null {
	for (const matcher of DATE_MATCHERS) {
		const match = matcher.re.exec(masked.text);
		if (!match) continue;
		const date = matcher.resolve(match, today);
		if (!date) continue;
		masked.take(match.index, match.index + match[0].length, 'date');
		return date;
	}
	return null;
}

function takeTime(masked: Masked): string | null {
	for (const matcher of TIME_MATCHERS) {
		const match = matcher.re.exec(masked.text);
		if (!match) continue;
		const time = matcher.resolve(match);
		if (!time) continue;
		masked.take(match.index, match.index + match[0].length, 'time');
		return time;
	}
	return null;
}

function resolveSchedule(
	date: string | null,
	time: string | null,
	recurrence: string | null,
	today: string
): { dueDate: string | null; dueTime: string | null; recurrence: string | null } {
	let dueDate = date;
	if (recurrence) {
		const rule = parseRecurrence(recurrence);
		if (rule) dueDate = firstOccurrence(rule, dueDate ?? today);
	}
	if (time && !dueDate) dueDate = today;
	return { dueDate, dueTime: time, recurrence };
}

export function parseQuickAdd(
	input: string,
	options: { today: string; projects?: QuickAddProject[] }
): QuickAddResult {
	const masked = new Masked(input);
	let projectId: string | null = null;
	let projectName: string | null = null;
	let unknownProject: string | null = null;

	const projects = [...(options.projects ?? [])].sort((a, b) => b.name.length - a.name.length);
	for (const project of projects) {
		const match = new RegExp(`${START}#${escapeRegExp(project.name)}(?=$|\\s)`, 'iu').exec(masked.text);
		if (match) {
			masked.take(match.index, match.index + match[0].length, 'project');
			projectId = project.id;
			projectName = project.name;
			break;
		}
	}
	if (!projectId) {
		const match = new RegExp(`${START}#([\\p{L}\\p{N}_-]+)`, 'u').exec(masked.text);
		if (match) unknownProject = match[1];
	}

	const labels: string[] = [];
	for (const match of masked.text.matchAll(new RegExp(`${START}@([\\p{L}\\p{N}_-]{1,60})(?=$|\\s)`, 'gu'))) {
		const name = match[1];
		if (!labels.some((label) => label.toLowerCase() === name.toLowerCase())) labels.push(name);
		masked.take(match.index ?? 0, (match.index ?? 0) + match[0].length, 'label');
	}

	let priority: Priority | null = null;
	const priorityMatch = new RegExp(`${START}p([1-4])(?=$|\\s)`, 'iu').exec(masked.text);
	if (priorityMatch) {
		priority = Number(priorityMatch[1]) as Priority;
		masked.take(priorityMatch.index, priorityMatch.index + priorityMatch[0].length, 'priority');
	}

	const recurrence = takeRecurrence(masked);
	const date = takeDate(masked, options.today);
	const time = takeTime(masked);
	const schedule = resolveSchedule(date, time, recurrence, options.today);

	return {
		title: masked.rest(),
		projectId,
		projectName,
		unknownProject,
		labels,
		priority,
		...schedule,
		tokens: masked.tokens.sort((a, b) => a.start - b.start)
	};
}

/**
 * Parses a standalone schedule such as "tomorrow 5pm" or "every monday".
 * Returns null when any part of the text is not understood.
 */
export function parseDueString(
	input: string,
	today: string
): { dueDate: string | null; dueTime: string | null; recurrence: string | null } | null {
	const masked = new Masked(input);
	const recurrence = takeRecurrence(masked);
	const date = takeDate(masked, today);
	const time = takeTime(masked);
	if (masked.rest() !== '') return null;
	return resolveSchedule(date, time, recurrence, today);
}
