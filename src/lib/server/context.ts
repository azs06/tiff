import { error, type RequestEvent } from '@sveltejs/kit';
import { todayInTimeZone } from '$lib/dates';
import type { User } from '$lib/types';
import { ensureUser } from './users';

export interface ServiceContext {
	db: D1Database;
	user: User;
	/** The user's current local date (YYYY-MM-DD), used for Today, overdue and recurrence. */
	today: string;
}

const cache = new WeakMap<App.Locals, Promise<ServiceContext>>();

export function contextFor(db: D1Database, user: User): ServiceContext {
	return { db, user, today: todayInTimeZone(user.timezone) };
}

/** Builds the per-request service context, creating the user's row and Inbox on first visit. */
export function getContext(event: Pick<RequestEvent, 'locals' | 'platform'>): Promise<ServiceContext> {
	const cached = cache.get(event.locals);
	if (cached) return cached;

	const db = event.platform?.env?.TIFF_DB;
	if (!db) throw error(500, 'The TIFF_DB D1 binding is not configured');

	const pending = ensureUser(db, event.locals.userEmail).then((user) => contextFor(db, user));
	cache.set(event.locals, pending);
	pending.catch(() => cache.delete(event.locals));
	return pending;
}
