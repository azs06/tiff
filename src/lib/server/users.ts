import { isValidTimeZone } from '$lib/dates';
import { THEMES, type Theme, type User } from '$lib/types';
import { invalid } from './errors';

type UserRow = { email: string; theme: string; timezone: string; inbox_project_id: string };

function mapUser(row: UserRow): User {
	return {
		email: row.email,
		theme: THEMES.includes(row.theme as Theme) ? (row.theme as Theme) : 'signal',
		timezone: isValidTimeZone(row.timezone) ? row.timezone : 'UTC',
		inboxProjectId: row.inbox_project_id
	};
}

async function findUser(db: D1Database, email: string): Promise<UserRow | null> {
	return db
		.prepare('SELECT email, theme, timezone, inbox_project_id FROM users WHERE email = ?')
		.bind(email)
		.first<UserRow>();
}

/**
 * Returns the user, creating the user row, their Inbox and its membership on first visit.
 * The three inserts run in one D1 batch (a single transaction), so a user row never exists
 * without its Inbox. Every statement is idempotent, so concurrent first requests converge.
 */
export async function ensureUser(db: D1Database, email: string): Promise<User> {
	const existing = await findUser(db, email);
	if (existing) return mapUser(existing);

	const now = Date.now();
	await db.batch([
		db
			.prepare(
				`INSERT INTO users (email, theme, timezone, inbox_project_id, created_at)
				 VALUES (?, 'signal', 'UTC', ?, ?) ON CONFLICT (email) DO NOTHING`
			)
			.bind(email, crypto.randomUUID(), now),
		db
			.prepare(
				`INSERT OR IGNORE INTO projects (id, owner_email, name, color, is_inbox, created_at, updated_at)
				 SELECT inbox_project_id, email, 'Inbox', 'blue', 1, ?, ? FROM users WHERE email = ?`
			)
			.bind(now, now, email),
		db
			.prepare(
				`INSERT OR IGNORE INTO project_members (project_id, email, role, added_by, added_at)
				 SELECT inbox_project_id, email, 'owner', email, ? FROM users WHERE email = ?`
			)
			.bind(now, email)
	]);

	const row = await findUser(db, email);
	if (!row) throw new Error('Failed to create user');
	return mapUser(row);
}

export async function updateUserSettings(
	db: D1Database,
	email: string,
	patch: { theme?: string; timezone?: string }
): Promise<void> {
	if (patch.theme !== undefined && !THEMES.includes(patch.theme as Theme)) throw invalid('Unknown theme');
	if (patch.timezone !== undefined && !isValidTimeZone(patch.timezone)) throw invalid('Unknown time zone');

	await db
		.prepare('UPDATE users SET theme = COALESCE(?, theme), timezone = COALESCE(?, timezone) WHERE email = ?')
		.bind(patch.theme ?? null, patch.timezone ?? null, email)
		.run();
}
