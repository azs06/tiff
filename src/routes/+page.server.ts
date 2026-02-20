import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getTodos, createTodo, toggleTodo, deleteTodo, logPomodoro, updateTodo, getTimer, saveTimer } from '$lib/kv';
import type { TimerState } from '$lib/types';

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
	const [todos, serverTimer] = await Promise.all([
		getTodos(kv, locals.userEmail),
		getTimer(kv, locals.userEmail)
	]);
	return { todos, serverTimer };
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
	}
};
