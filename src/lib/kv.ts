import type { Todo, PomodoroLog, TimerState } from './types';

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
