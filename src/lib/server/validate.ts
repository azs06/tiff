import { isValidDate, isValidTime } from '$lib/dates';
import { firstOccurrence, normalizeRecurrence, parseRecurrence } from '$lib/recurrence';
import { isProjectColor, type Priority, type ProjectColor } from '$lib/types';
import { invalid } from './errors';

export const LIMITS = {
	title: 500,
	notes: 20_000,
	name: 120,
	label: 60,
	labelsPerTask: 20,
	comment: 10_000,
	tokenName: 80
} as const;

const LABEL_RE = /^[\p{L}\p{N}_-]+$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

export function requiredText(value: unknown, field: string, max: number): string {
	const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
	if (!text) throw invalid(`${field} is required`);
	if (text.length > max) throw invalid(`${field} must be at most ${max} characters`);
	return text;
}

export function optionalText(value: unknown, field: string, max: number): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string') throw invalid(`${field} must be text`);
	const text = value.trim();
	if (!text) return null;
	if (text.length > max) throw invalid(`${field} must be at most ${max} characters`);
	return text;
}

export function priority(value: unknown): Priority {
	const n = typeof value === 'string' ? Number(value) : value;
	if (n === 1 || n === 2 || n === 3 || n === 4) return n;
	throw invalid('Priority must be 1, 2, 3 or 4');
}

export function color(value: unknown): ProjectColor {
	if (isProjectColor(value)) return value;
	throw invalid('Unknown project color');
}

export function email(value: unknown): string {
	const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
	if (!EMAIL_RE.test(text) || text.length > 254) throw invalid('Enter a valid email address');
	return text;
}

export function labels(values: unknown): string[] {
	if (!Array.isArray(values)) throw invalid('Labels must be a list');
	const result: string[] = [];
	for (const raw of values) {
		if (typeof raw !== 'string') throw invalid('Labels must be text');
		const name = raw.trim().replace(/^@/, '');
		if (!name) continue;
		if (name.length > LIMITS.label) throw invalid(`Labels must be at most ${LIMITS.label} characters`);
		if (!LABEL_RE.test(name)) throw invalid(`Label "${name}" may only contain letters, numbers, - and _`);
		if (!result.some((label) => label.toLowerCase() === name.toLowerCase())) result.push(name);
	}
	if (result.length > LIMITS.labelsPerTask) throw invalid(`A task can have at most ${LIMITS.labelsPerTask} labels`);
	return result;
}

/** Splits "work, errands @home" into label names. */
export function labelList(text: string): string[] {
	return labels(text.split(/[\s,]+/));
}

export interface Schedule {
	dueDate: string | null;
	dueTime: string | null;
	recurrence: string | null;
}

/** Validates and normalises a due date, time and recurrence together. */
export function schedule(input: Schedule, today: string): Schedule {
	let { dueDate, dueTime, recurrence } = input;
	if (dueDate !== null && !isValidDate(dueDate)) throw invalid('Due date must be YYYY-MM-DD');
	if (dueTime !== null && !isValidTime(dueTime)) throw invalid('Due time must be HH:MM (24-hour)');

	if (recurrence !== null) {
		const normalized = normalizeRecurrence(recurrence);
		if (!normalized) {
			throw invalid(`Could not understand recurrence "${recurrence}". Try "every day", "every 2 weeks" or "every mon, fri".`);
		}
		recurrence = normalized;
		if (!dueDate) dueDate = firstOccurrence(parseRecurrence(normalized)!, today);
	}
	if (dueTime && !dueDate) dueDate = today;
	if (!dueDate) {
		dueTime = null;
		recurrence = null;
	}
	return { dueDate, dueTime, recurrence };
}
