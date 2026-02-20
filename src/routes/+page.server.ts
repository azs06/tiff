import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getTodos, createTodo, toggleTodo, deleteTodo, logPomodoro, updateTodo, getTimer, saveTimer, getSettings, saveSettings, archiveTodo, unarchiveTodo, getPomodoroLogs, addTaskLog, deleteTaskLog, addResource, deleteResource } from '$lib/kv';
import type { TimerState, UserSettings, Theme } from '$lib/types';
import { THEMES } from '$lib/types';

function resolveDeadline(value: string | undefined, timezoneOffset: number): number | undefined {
	if (!value) return undefined;

	const now = new Date();
	// Shift to user's local time by subtracting the offset
	const userNow = new Date(now.getTime() - timezoneOffset * 60_000);

	if (value === 'today' || value === 'tomorrow') {
		const d = new Date(userNow);
		if (value === 'tomorrow') d.setUTCDate(d.getUTCDate() + 1);
		d.setUTCHours(23, 59, 59, 999);
		// Convert back to real UTC
		return d.getTime() + timezoneOffset * 60_000;
	}

	// datetime-local string like "2026-02-20T14:30"
	const parsed = new Date(value);
	if (isNaN(parsed.getTime())) return undefined;
	// datetime-local is parsed as UTC, but user meant local time — apply offset
	return parsed.getTime() + timezoneOffset * 60_000;
}

export const load: PageServerLoad = async ({ locals, platform }) => {
	const kv = platform!.env.TIFF_KV;
	const [allTodos, serverTimer, settings, pomodoroLogs] = await Promise.all([
		getTodos(kv, locals.userEmail),
		getTimer(kv, locals.userEmail),
		getSettings(kv, locals.userEmail),
		getPomodoroLogs(kv, locals.userEmail)
	]);
	const todos = allTodos.filter((t) => !t.archived);
	const archivedTodos = allTodos.filter((t) => t.archived);
	return { todos, archivedTodos, serverTimer, settings, pomodoroLogs };
};

export const actions: Actions = {
	create: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const title = data.get('title')?.toString().trim();
		if (!title) return fail(400, { error: 'Title is required' });
		const detail = data.get('detail')?.toString().trim() || undefined;
		const tzOffset = Number(data.get('timezoneOffset') || 0);
		const deadline = resolveDeadline(data.get('deadline')?.toString().trim(), tzOffset);
		await createTodo(kv, locals.userEmail, title, { detail, deadline });
	},

	toggle: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await toggleTodo(kv, locals.userEmail, id);
	},

	delete: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await deleteTodo(kv, locals.userEmail, id);
	},

	update: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		const detail = data.get('detail')?.toString().trim() ?? undefined;
		const tzOffset = Number(data.get('timezoneOffset') || 0);
		const deadlineRaw = data.get('deadline')?.toString().trim();
		const deadline = deadlineRaw ? resolveDeadline(deadlineRaw, tzOffset) : null;
		await updateTodo(kv, locals.userEmail, id, {
			...(detail !== undefined && { detail }),
			...(deadline !== undefined && { deadline })
		});
	},

	logPomodoro: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		const type = data.get('type')?.toString() as 'work' | 'short-break' | 'long-break';
		const duration = Number(data.get('duration'));
		if (!taskId || !type || !duration) return fail(400);
		await logPomodoro(kv, locals.userEmail, { taskId, type, duration });
	},

	syncTimer: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const raw = data.get('timer')?.toString();
		if (!raw || raw === 'null') {
			await saveTimer(kv, locals.userEmail, null);
		} else {
			const parsed = JSON.parse(raw) as TimerState;
			await saveTimer(kv, locals.userEmail, parsed);
		}
	},

	archive: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await archiveTodo(kv, locals.userEmail, id);
	},

	unarchive: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await unarchiveTodo(kv, locals.userEmail, id);
	},

	saveSettings: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const existing = await getSettings(kv, locals.userEmail);
		const clamp = (v: number) => Math.max(1, Math.min(120, v));
		const workMin = clamp(Number(data.get('work') || 25));
		const shortBreakMin = clamp(Number(data.get('shortBreak') || 5));
		const longBreakMin = clamp(Number(data.get('longBreak') || 15));
		const settings: UserSettings = {
			...existing,
			workMs: workMin * 60 * 1000,
			shortBreakMs: shortBreakMin * 60 * 1000,
			longBreakMs: longBreakMin * 60 * 1000
		};
		await saveSettings(kv, locals.userEmail, settings);
	},

	saveTheme: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const theme = data.get('theme')?.toString() as Theme;
		if (!theme || !THEMES.includes(theme)) return fail(400);
		const existing = await getSettings(kv, locals.userEmail);
		await saveSettings(kv, locals.userEmail, { ...existing, theme });
	},

	addLog: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		const text = data.get('text')?.toString().trim();
		if (!id || !text) return fail(400);
		await addTaskLog(kv, locals.userEmail, id, text);
	},

	deleteLog: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		const logId = data.get('logId')?.toString();
		if (!id || !logId) return fail(400);
		await deleteTaskLog(kv, locals.userEmail, id, logId);
	},

	addResource: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		const url = data.get('url')?.toString().trim();
		if (!id || !url) return fail(400);
		const label = data.get('label')?.toString().trim() || undefined;
		await addResource(kv, locals.userEmail, id, url, label);
	},

	deleteResource: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		const resourceId = data.get('resourceId')?.toString();
		if (!id || !resourceId) return fail(400);
		await deleteResource(kv, locals.userEmail, id, resourceId);
	}
};
