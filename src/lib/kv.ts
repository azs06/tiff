import type { Todo, PomodoroLog, TimerState, UserSettings, TaskLog, Resource } from './types';
import { DEFAULT_SETTINGS } from './types';

export async function getTodos(kv: KVNamespace, email: string): Promise<Todo[]> {
	const data = await kv.get(`todos:${email}`, 'json');
	return (data as Todo[]) ?? [];
}

export async function saveTodos(kv: KVNamespace, email: string, todos: Todo[]): Promise<void> {
	await kv.put(`todos:${email}`, JSON.stringify(todos));
}

export async function createTodo(
	kv: KVNamespace,
	email: string,
	title: string,
	opts?: { detail?: string; deadline?: number }
): Promise<void> {
	const todos = await getTodos(kv, email);
	const todo: Todo = {
		id: crypto.randomUUID(),
		title,
		done: false,
		createdAt: Date.now()
	};
	if (opts?.detail) todo.detail = opts.detail;
	if (opts?.deadline) todo.deadline = opts.deadline;
	todos.unshift(todo);
	await saveTodos(kv, email, todos);
}

export async function updateTodo(
	kv: KVNamespace,
	email: string,
	id: string,
	patch: { detail?: string; deadline?: number | null }
): Promise<void> {
	const todos = await getTodos(kv, email);
	const todo = todos.find((t) => t.id === id);
	if (!todo) return;
	if (patch.detail !== undefined) {
		if (patch.detail) {
			todo.detail = patch.detail;
		} else {
			delete todo.detail;
		}
	}
	if (patch.deadline !== undefined) {
		if (patch.deadline) {
			todo.deadline = patch.deadline;
		} else {
			delete todo.deadline;
		}
	}
	await saveTodos(kv, email, todos);
}

export async function toggleTodo(kv: KVNamespace, email: string, id: string): Promise<void> {
	const todos = await getTodos(kv, email);
	const todo = todos.find((t) => t.id === id);
	if (todo) {
		todo.done = !todo.done;
		await saveTodos(kv, email, todos);
	}
}

export async function deleteTodo(kv: KVNamespace, email: string, id: string): Promise<void> {
	const todos = await getTodos(kv, email);
	await saveTodos(kv, email, todos.filter((t) => t.id !== id));
}

export async function getTimer(kv: KVNamespace, email: string): Promise<TimerState | null> {
	const data = await kv.get(`timer:${email}`, 'json');
	return (data as TimerState) ?? null;
}

export async function saveTimer(kv: KVNamespace, email: string, timer: TimerState | null): Promise<void> {
	if (timer === null) {
		await kv.delete(`timer:${email}`);
	} else {
		await kv.put(`timer:${email}`, JSON.stringify(timer));
	}
}

export async function logPomodoro(
	kv: KVNamespace,
	email: string,
	entry: Omit<PomodoroLog, 'completedAt'>
): Promise<void> {
	const key = `pomodoros:${email}`;
	const logs = ((await kv.get(key, 'json')) as PomodoroLog[]) ?? [];
	logs.push({ ...entry, completedAt: Date.now() });
	await kv.put(key, JSON.stringify(logs));
}

export async function getSettings(kv: KVNamespace, email: string): Promise<UserSettings> {
	const data = await kv.get(`settings:${email}`, 'json');
	return { ...DEFAULT_SETTINGS, ...(data as Partial<UserSettings>) };
}

export async function saveSettings(kv: KVNamespace, email: string, settings: UserSettings): Promise<void> {
	await kv.put(`settings:${email}`, JSON.stringify(settings));
}

export async function archiveTodo(kv: KVNamespace, email: string, id: string): Promise<void> {
	const todos = await getTodos(kv, email);
	const todo = todos.find((t) => t.id === id);
	if (todo) {
		todo.archived = true;
		todo.archivedAt = Date.now();
		await saveTodos(kv, email, todos);
	}
}

export async function unarchiveTodo(kv: KVNamespace, email: string, id: string): Promise<void> {
	const todos = await getTodos(kv, email);
	const todo = todos.find((t) => t.id === id);
	if (todo) {
		delete todo.archived;
		delete todo.archivedAt;
		todo.done = false;
		await saveTodos(kv, email, todos);
	}
}

export async function getPomodoroLogs(kv: KVNamespace, email: string): Promise<PomodoroLog[]> {
	const key = `pomodoros:${email}`;
	return ((await kv.get(key, 'json')) as PomodoroLog[]) ?? [];
}

export async function addTaskLog(kv: KVNamespace, email: string, todoId: string, text: string): Promise<void> {
	const todos = await getTodos(kv, email);
	const todo = todos.find((t) => t.id === todoId);
	if (!todo) return;
	const log: TaskLog = { id: crypto.randomUUID(), text, createdAt: Date.now() };
	todo.logs = [...(todo.logs ?? []), log];
	await saveTodos(kv, email, todos);
}

export async function deleteTaskLog(kv: KVNamespace, email: string, todoId: string, logId: string): Promise<void> {
	const todos = await getTodos(kv, email);
	const todo = todos.find((t) => t.id === todoId);
	if (!todo || !todo.logs) return;
	todo.logs = todo.logs.filter((l) => l.id !== logId);
	await saveTodos(kv, email, todos);
}

export async function addResource(kv: KVNamespace, email: string, todoId: string, url: string, label?: string): Promise<void> {
	const todos = await getTodos(kv, email);
	const todo = todos.find((t) => t.id === todoId);
	if (!todo) return;
	const resource: Resource = { id: crypto.randomUUID(), url, createdAt: Date.now() };
	if (label) resource.label = label;
	todo.resources = [...(todo.resources ?? []), resource];
	await saveTodos(kv, email, todos);
}

export async function deleteResource(kv: KVNamespace, email: string, todoId: string, resourceId: string): Promise<void> {
	const todos = await getTodos(kv, email);
	const todo = todos.find((t) => t.id === todoId);
	if (!todo || !todo.resources) return;
	todo.resources = todo.resources.filter((r) => r.id !== resourceId);
	await saveTodos(kv, email, todos);
}
