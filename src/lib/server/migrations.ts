import * as d1Store from '$lib/d1';
import * as kvStore from '$lib/kv';
import { DEFAULT_SETTINGS, type FocusState, type PomodoroLog, type Project, type Todo } from '$lib/types';

const EMAIL_PREFIXES = ['todos:', 'pomodoros:', 'focus:', 'sessions:', 'projects:', 'settings:', 'timer:'] as const;

export type UserParityResult = {
	email: string;
	matches: boolean;
	mismatches: string[];
	counts: {
		todos: number;
		taskLogs: number;
		projects: number;
		resources: number;
		attachments: number;
		sessions: number;
		pomodoroLogs: number;
		totalFocusMs: number;
	};
};

export type MigrationRunRecord = {
	runId: string;
	startedAt: number;
	finishedAt: number | null;
	status: 'running' | 'completed' | 'failed';
	totalUsers: number;
	processedUsers: number;
	mismatchedUsers: number;
	notes: string | null;
};

function parseBool(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0;
	if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
	return false;
}

function normalizeFocus(focus: FocusState | null): FocusState | null {
	if (!focus) return null;
	const next: FocusState = {
		activeTaskId: focus.activeTaskId,
		focusedAt: focus.focusedAt
	};
	if (focus.sessionPaused !== undefined) next.sessionPaused = parseBool(focus.sessionPaused);
	if (focus.pausedAt !== undefined) next.pausedAt = focus.pausedAt;
	if (focus.accumulatedPauseMs !== undefined) next.accumulatedPauseMs = focus.accumulatedPauseMs;
	if (focus.pomodoro) {
		next.pomodoro = {
			startedAt: focus.pomodoro.startedAt,
			duration: focus.pomodoro.duration,
			type: focus.pomodoro.type,
			completedPomodoros: focus.pomodoro.completedPomodoros,
			paused: parseBool(focus.pomodoro.paused),
			pausedRemaining: focus.pomodoro.pausedRemaining
		};
	}
	return next;
}

function normalizeTodos(todos: Todo[]): Todo[] {
	return [...todos]
		.map((todo) => ({
			...todo,
			logs: todo.logs
				? [...todo.logs].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
				: undefined
		}))
		.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

function normalizeProjects(projects: Project[]): Project[] {
	return [...projects]
		.map((project) => ({
			...project,
			resources: project.resources
				? [...project.resources].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
				: undefined,
			attachments: project.attachments
				? [...project.attachments].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
				: undefined
		}))
		.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

function normalizeSessions(sessions: Array<{ id: string; taskId: string; startedAt: number; endedAt?: number; endReason?: string }>) {
	return [...sessions].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}

function normalizePomodoroLogs(logs: PomodoroLog[]) {
	return [...logs].sort((a, b) => a.completedAt - b.completedAt || a.taskId.localeCompare(b.taskId));
}

function stableJson(value: unknown): string {
	return JSON.stringify(value);
}

export async function collectAllUserEmails(kv: KVNamespace): Promise<string[]> {
	const users = new Set<string>();
	for (const prefix of EMAIL_PREFIXES) {
		let cursor: string | undefined;
		let done = false;
		while (!done) {
			const listed = await kv.list({ prefix, cursor, limit: 1000 });
			for (const key of listed.keys) {
				const email = key.name.slice(prefix.length).trim();
				if (email) users.add(email);
			}
			if (listed.list_complete) {
				done = true;
			} else {
				cursor = listed.cursor;
			}
		}
	}
	return Array.from(users).sort();
}

function migrateLegacyTimer(focus: FocusState | null, timer: Awaited<ReturnType<typeof kvStore.getTimer>>): FocusState | null {
	if (focus || !timer) return focus;
	return {
		activeTaskId: timer.activeTaskId,
		focusedAt: timer.startedAt,
		pomodoro: {
			startedAt: timer.startedAt,
			duration: timer.duration,
			type: timer.type,
			completedPomodoros: timer.completedPomodoros,
			paused: timer.paused,
			pausedRemaining: timer.pausedRemaining
		}
	};
}

export async function backfillUser(kv: KVNamespace, db: D1Database, email: string): Promise<void> {
	const [todos, projects, sessions, pomodoroLogs, settings, focus, timer] = await Promise.all([
		kvStore.getTodos(kv, email),
		kvStore.getProjects(kv, email),
		kvStore.getSessions(kv, email),
		kvStore.getPomodoroLogs(kv, email),
		kvStore.getSettings(kv, email),
		kvStore.getFocus(kv, email),
		kvStore.getTimer(kv, email)
	]);

	const migratedFocus = migrateLegacyTimer(focus, timer);

	await d1Store.saveTodos(db, email, todos);
	await d1Store.saveProjects(db, email, projects);
	await d1Store.saveSessions(db, email, sessions);
	await d1Store.replacePomodoroLogs(db, email, pomodoroLogs);
	await d1Store.saveSettings(db, email, settings);
	await d1Store.saveFocus(db, email, migratedFocus);
}

export async function ensureMigrationRun(db: D1Database, runId: string): Promise<void> {
	await db
		.prepare(
			`INSERT INTO migration_runs (run_id, started_at, status, cursor, processed_users, mismatched_users)
			 VALUES (?, ?, 'running', NULL, 0, 0)
			 ON CONFLICT(run_id) DO NOTHING`
		)
		.bind(runId, Date.now())
		.run();
}

type MigrationRunRow = {
	run_id: string;
	started_at: number;
	finished_at: number | null;
	status: string;
	cursor: string | null;
	processed_users: number;
	mismatched_users: number;
	notes: string | null;
};

export async function getMigrationRun(db: D1Database, runId: string): Promise<MigrationRunRecord | null> {
	const row = await db
		.prepare(
			`SELECT run_id, started_at, finished_at, status, cursor, processed_users, mismatched_users, notes
			 FROM migration_runs
			 WHERE run_id = ?
			 LIMIT 1`
		)
		.bind(runId)
		.first<MigrationRunRow>();
	if (!row) return null;
	return {
		runId: row.run_id,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		status: row.status as MigrationRunRecord['status'],
		totalUsers: Number(row.cursor) || 0,
		processedUsers: row.processed_users,
		mismatchedUsers: row.mismatched_users,
		notes: row.notes
	};
}

export async function getLatestMigrationRun(db: D1Database): Promise<MigrationRunRecord | null> {
	const row = await db
		.prepare(
			`SELECT run_id, started_at, finished_at, status, cursor, processed_users, mismatched_users, notes
			 FROM migration_runs
			 ORDER BY started_at DESC
			 LIMIT 1`
		)
		.first<MigrationRunRow>();
	if (!row) return null;
	return {
		runId: row.run_id,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		status: row.status as MigrationRunRecord['status'],
		totalUsers: Number(row.cursor) || 0,
		processedUsers: row.processed_users,
		mismatchedUsers: row.mismatched_users,
		notes: row.notes
	};
}

export async function updateMigrationRunProgress(
	db: D1Database,
	runId: string,
	patch: {
		status?: 'running' | 'completed' | 'failed';
		totalUsers?: number;
		processedUsersDelta?: number;
		mismatchedUsers?: number;
		notes?: string;
		finished?: boolean;
	}
): Promise<void> {
	const sets: string[] = [];
	const values: Array<string | number | null> = [];

	if (patch.status) {
		sets.push('status = ?');
		values.push(patch.status);
	}
	if (patch.totalUsers !== undefined) {
		sets.push('cursor = ?');
		values.push(String(patch.totalUsers));
	}
	if (patch.processedUsersDelta !== undefined) {
		sets.push('processed_users = processed_users + ?');
		values.push(patch.processedUsersDelta);
	}
	if (patch.mismatchedUsers !== undefined) {
		sets.push('mismatched_users = ?');
		values.push(patch.mismatchedUsers);
	}
	if (patch.notes !== undefined) {
		sets.push('notes = ?');
		values.push(patch.notes);
	}
	if (patch.finished) {
		sets.push('finished_at = ?');
		values.push(Date.now());
	}

	if (sets.length === 0) return;
	values.push(runId);
	await db.prepare(`UPDATE migration_runs SET ${sets.join(', ')} WHERE run_id = ?`).bind(...values).run();
}

export async function parityCheckUser(kv: KVNamespace, db: D1Database, email: string): Promise<UserParityResult> {
	const [kvTodos, kvProjects, kvSessions, kvPomodoros, kvSettings, kvFocus, d1Todos, d1Projects, d1Sessions, d1Pomodoros, d1Settings, d1Focus] =
		await Promise.all([
			kvStore.getTodos(kv, email),
			kvStore.getProjects(kv, email),
			kvStore.getSessions(kv, email),
			kvStore.getPomodoroLogs(kv, email),
			kvStore.getSettings(kv, email),
			kvStore.getFocus(kv, email),
			d1Store.getTodos(db, email),
			d1Store.getProjects(db, email),
			d1Store.getSessions(db, email),
			d1Store.getPomodoroLogs(db, email),
			d1Store.getSettings(db, email),
			d1Store.getFocus(db, email)
		]);

	const kvTodosNorm = normalizeTodos(kvTodos);
	const d1TodosNorm = normalizeTodos(d1Todos);
	const kvProjectsNorm = normalizeProjects(kvProjects);
	const d1ProjectsNorm = normalizeProjects(d1Projects);
	const kvSessionsNorm = normalizeSessions(kvSessions);
	const d1SessionsNorm = normalizeSessions(d1Sessions);
	const kvPomodorosNorm = normalizePomodoroLogs(kvPomodoros);
	const d1PomodorosNorm = normalizePomodoroLogs(d1Pomodoros);
	const kvFocusNorm = normalizeFocus(kvFocus);
	const d1FocusNorm = normalizeFocus(d1Focus);

	const mismatches: string[] = [];
	if (stableJson(kvTodosNorm) !== stableJson(d1TodosNorm)) mismatches.push('todos');
	if (stableJson(kvProjectsNorm) !== stableJson(d1ProjectsNorm)) mismatches.push('projects');
	if (stableJson(kvSessionsNorm) !== stableJson(d1SessionsNorm)) mismatches.push('sessions');
	if (stableJson(kvPomodorosNorm) !== stableJson(d1PomodorosNorm)) mismatches.push('pomodoroLogs');
	if (stableJson(kvFocusNorm) !== stableJson(d1FocusNorm)) mismatches.push('focusState');
	if (stableJson(kvSettings ?? DEFAULT_SETTINGS) !== stableJson(d1Settings ?? DEFAULT_SETTINGS)) {
		mismatches.push('settings');
	}

	const counts = {
		todos: d1TodosNorm.length,
		taskLogs: d1TodosNorm.reduce((sum, todo) => sum + (todo.logs?.length ?? 0), 0),
		projects: d1ProjectsNorm.length,
		resources: d1ProjectsNorm.reduce((sum, project) => sum + (project.resources?.length ?? 0), 0),
		attachments: d1ProjectsNorm.reduce((sum, project) => sum + (project.attachments?.length ?? 0), 0),
		sessions: d1SessionsNorm.length,
		pomodoroLogs: d1PomodorosNorm.length,
		totalFocusMs: d1TodosNorm.reduce((sum, todo) => sum + (todo.totalFocusMs ?? 0), 0)
	};

	const kvTotalFocus = kvTodosNorm.reduce((sum, todo) => sum + (todo.totalFocusMs ?? 0), 0);
	if (kvTotalFocus !== counts.totalFocusMs) mismatches.push('totalFocusMs');

	return {
		email,
		matches: mismatches.length === 0,
		mismatches,
		counts
	};
}
