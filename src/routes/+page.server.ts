import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	getTodos, createTodo, toggleTodo, deleteTodo, logPomodoro, updateTodo,
	getTimer, saveTimer, getSettings, saveSettings, archiveTodo, unarchiveTodo,
	getPomodoroLogs, addTaskLog, deleteTaskLog, addResource, deleteResource,
	getProjects, saveProjects, getFocus, saveFocus, getSessions, endActiveSession, startSession, saveTodos
} from '$lib/kv';
import type { TimerState, UserSettings, Theme, FocusState } from '$lib/types';
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
	const email = locals.userEmail;

	const [allTodos, serverFocus, settings, pomodoroLogs, projects, sessions] = await Promise.all([
		getTodos(kv, email),
		getFocus(kv, email),
		getSettings(kv, email),
		getPomodoroLogs(kv, email),
		getProjects(kv, email),
		getSessions(kv, email)
	]);

	// Migration: convert old TimerState to FocusState
	let focus = serverFocus;
	if (!focus) {
		const oldTimer = await getTimer(kv, email);
		if (oldTimer) {
			focus = {
				activeTaskId: oldTimer.activeTaskId,
				focusedAt: oldTimer.startedAt,
				pomodoro: {
					startedAt: oldTimer.startedAt,
					duration: oldTimer.duration,
					type: oldTimer.type,
					completedPomodoros: oldTimer.completedPomodoros,
					paused: oldTimer.paused,
					pausedRemaining: oldTimer.pausedRemaining
				}
			};
			await saveFocus(kv, email, focus);
			await saveTimer(kv, email, null);
		}
	}

	const todos = allTodos.filter((t) => !t.archived);
	const archivedTodos = allTodos.filter((t) => t.archived);
	return { todos, archivedTodos, serverFocus: focus, settings, pomodoroLogs, projects, sessions };
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
		const projectId = data.get('projectId')?.toString().trim() || undefined;
		await createTodo(kv, locals.userEmail, title, { detail, deadline, projectId });
	},

	toggle: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);

		const todos = await getTodos(kv, locals.userEmail);
		const todo = todos.find((t) => t.id === id);
		if (!todo) return;

		todo.done = !todo.done;
		await saveTodos(kv, locals.userEmail, todos);

		// If marking done and this was the focused task, end session + clear focus
		if (todo.done) {
			const focus = await getFocus(kv, locals.userEmail);
			if (focus?.activeTaskId === id) {
				await endActiveSession(kv, locals.userEmail, 'done');
				await saveFocus(kv, locals.userEmail, null);
			}
		}
	},

	delete: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);

		// If deleting the focused task, end session + clear focus
		const focus = await getFocus(kv, locals.userEmail);
		if (focus?.activeTaskId === id) {
			await endActiveSession(kv, locals.userEmail, 'manual');
			await saveFocus(kv, locals.userEmail, null);
		}

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

	syncFocus: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const raw = data.get('focus')?.toString();
		if (!raw || raw === 'null') {
			await saveFocus(kv, locals.userEmail, null);
		} else {
			const parsed = JSON.parse(raw) as FocusState;
			await saveFocus(kv, locals.userEmail, parsed);
		}
	},

	focusTask: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);

		// End any existing session
		await endActiveSession(kv, locals.userEmail, 'switch');

		// Start new session + set focus
		await startSession(kv, locals.userEmail, taskId);
		await saveFocus(kv, locals.userEmail, {
			activeTaskId: taskId,
			focusedAt: Date.now()
		});
	},

	unfocus: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		await endActiveSession(kv, locals.userEmail, 'manual');
		await saveFocus(kv, locals.userEmail, null);
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
	},

	createProject: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400);
		const projects = await getProjects(kv, locals.userEmail);
		projects.push({
			id: crypto.randomUUID(),
			name,
			createdAt: Date.now()
		});
		await saveProjects(kv, locals.userEmail, projects);
	},

	deleteProject: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);

		// Remove project
		const projects = await getProjects(kv, locals.userEmail);
		await saveProjects(kv, locals.userEmail, projects.filter((p) => p.id !== id));

		// Unset projectId on all tasks belonging to this project
		const todos = await getTodos(kv, locals.userEmail);
		let changed = false;
		for (const todo of todos) {
			if (todo.projectId === id) {
				delete todo.projectId;
				changed = true;
			}
		}
		if (changed) await saveTodos(kv, locals.userEmail, todos);
	},

	setTaskProject: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const todoId = data.get('todoId')?.toString();
		const projectId = data.get('projectId')?.toString().trim() || undefined;
		if (!todoId) return fail(400);

		const todos = await getTodos(kv, locals.userEmail);
		const todo = todos.find((t) => t.id === todoId);
		if (!todo) return;

		if (projectId) {
			todo.projectId = projectId;
		} else {
			delete todo.projectId;
		}
		await saveTodos(kv, locals.userEmail, todos);
	}
};
