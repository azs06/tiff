import * as d1Store from './d1';
import {
	ensureOpenSession,
	expandFocusedTask,
	getFocusedTask,
	normalizeFocusState,
	removeFocusedTask,
	stopFocusedTask,
	upsertFocusedTask
} from './focus';
import * as kvStore from './kv';
import type {
	FocusSession,
	FocusState,
	GitHubRepoInfo,
	Project,
	ProjectAttachment,
	Todo,
	UserSettings
} from './types';

function getKV(env: App.Platform['env'] | undefined): KVNamespace | undefined {
	return env?.TIFF_KV;
}

function getD1(env: App.Platform['env'] | undefined): D1Database | undefined {
	return env?.TIFF_DB;
}

async function read<T>(
	env: App.Platform['env'] | undefined,
	op: string,
	kvRead: (kv: KVNamespace) => Promise<T>,
	d1Read: (db: D1Database) => Promise<T>
): Promise<T> {
	const d1 = getD1(env);
	if (d1) return d1Read(d1);

	const kv = getKV(env);
	if (kv) return kvRead(kv);

	throw new Error(`Storage unavailable for read operation ${op}`);
}

async function write<T>(
	env: App.Platform['env'] | undefined,
	op: string,
	kvWrite: (kv: KVNamespace) => Promise<T>,
	d1Write: (db: D1Database) => Promise<T>
): Promise<T> {
	const d1 = getD1(env);
	if (d1) return d1Write(d1);

	const kv = getKV(env);
	if (kv) return kvWrite(kv);

	throw new Error(`Storage unavailable for write operation ${op}`);
}

function kvOnly<T>(
	env: App.Platform['env'] | undefined,
	op: string,
	fn: (kv: KVNamespace) => Promise<T>
): Promise<T> {
	const kv = getKV(env);
	if (!kv) throw new Error(`KV unavailable for ${op}`);
	return fn(kv);
}

type UnifiedStore<TStore extends KVNamespace | D1Database> = {
	getFocus: (store: TStore, email: string) => Promise<FocusState | null>;
	saveFocus: (store: TStore, email: string, focus: FocusState | null) => Promise<void>;
	getSessions: (store: TStore, email: string) => Promise<FocusSession[]>;
	saveSessions: (store: TStore, email: string, sessions: FocusSession[]) => Promise<void>;
	getTodos: (store: TStore, email: string) => Promise<Todo[]>;
	saveTodos: (store: TStore, email: string, todos: Todo[]) => Promise<void>;
};

function cloneTodos(todos: Todo[]): Todo[] {
	return todos.map((todo) => ({
		...todo,
		logs: todo.logs ? todo.logs.map((log) => ({ ...log })) : undefined
	}));
}

function cloneSessions(sessions: FocusSession[]): FocusSession[] {
	return sessions.map((session) => ({ ...session }));
}

function updateTodoFocusTotal(todos: Todo[], taskId: string, duration: number) {
	if (duration <= 0) return;
	const todo = todos.find((item) => item.id === taskId);
	if (!todo) return;
	todo.totalFocusMs = (todo.totalFocusMs ?? 0) + duration;
}

function closeRunningInterval(
	sessions: FocusSession[],
	todos: Todo[],
	taskId: string,
	startedAt: number | undefined,
	reason: FocusSession['endReason'],
	now: number
) {
	const openIndex = [...sessions]
		.map((session, index) => ({ session, index }))
		.reverse()
		.find(({ session }) => session.taskId === taskId && !session.endedAt)?.index;

	if (openIndex !== undefined) {
		const open = sessions[openIndex];
		open.endedAt = now;
		open.endReason = reason;
		updateTodoFocusTotal(todos, taskId, Math.max(0, now - open.startedAt));
		return;
	}

	if (startedAt !== undefined) {
		sessions.push({
			id: crypto.randomUUID(),
			taskId,
			startedAt,
			endedAt: now,
			endReason: reason
		});
		updateTodoFocusTotal(todos, taskId, Math.max(0, now - startedAt));
	}
}

async function mutateFocusState(
	env: App.Platform['env'] | undefined,
	email: string,
	op: string,
	mutate: (ctx: {
		focus: FocusState | null;
		sessions: FocusSession[];
		todos: Todo[];
		now: number;
	}) => {
		focus: FocusState | null;
		sessions: FocusSession[];
		todos: Todo[];
	}
): Promise<void> {
	const kvAdapter: UnifiedStore<KVNamespace> = {
		getFocus: kvStore.getFocus,
		saveFocus: kvStore.saveFocus,
		getSessions: kvStore.getSessions,
		saveSessions: kvStore.saveSessions,
		getTodos: kvStore.getTodos,
		saveTodos: kvStore.saveTodos
	};
	const d1Adapter: UnifiedStore<D1Database> = {
		getFocus: d1Store.getFocus,
		saveFocus: d1Store.saveFocus,
		getSessions: d1Store.getSessions,
		saveSessions: d1Store.saveSessions,
		getTodos: d1Store.getTodos,
		saveTodos: d1Store.saveTodos
	};

	await write(
		env,
		op,
		async (kv) => {
			await mutateFocusStateInStore(kvAdapter, kv, email, mutate);
		},
		async (db) => {
			await mutateFocusStateInStore(d1Adapter, db, email, mutate);
		}
	);
}

async function mutateFocusStateInStore<TStore extends KVNamespace | D1Database>(
	store: UnifiedStore<TStore>,
	backend: TStore,
	email: string,
	mutate: (ctx: {
		focus: FocusState | null;
		sessions: FocusSession[];
		todos: Todo[];
		now: number;
	}) => {
		focus: FocusState | null;
		sessions: FocusSession[];
		todos: Todo[];
	}
) {
	const [focus, sessions, todos] = await Promise.all([
		store.getFocus(backend, email),
		store.getSessions(backend, email),
		store.getTodos(backend, email)
	]);

	const result = mutate({
		focus: normalizeFocusState(focus),
		sessions: cloneSessions(sessions),
		todos: cloneTodos(todos),
		now: Date.now()
	});

	await Promise.all([
		store.saveFocus(backend, email, normalizeFocusState(result.focus)),
		store.saveSessions(backend, email, result.sessions),
		store.saveTodos(backend, email, result.todos)
	]);
}

export function hasAnyStorage(env: App.Platform['env'] | undefined): boolean {
	return Boolean(getKV(env) || getD1(env));
}

export async function getTodos(env: App.Platform['env'] | undefined, email: string): Promise<Todo[]> {
	return read(env, 'getTodos', (kv) => kvStore.getTodos(kv, email), (db) => d1Store.getTodos(db, email));
}

export async function saveTodos(env: App.Platform['env'] | undefined, email: string, todos: Todo[]): Promise<void> {
	await write(env, 'saveTodos', (kv) => kvStore.saveTodos(kv, email, todos), (db) => d1Store.saveTodos(db, email, todos));
}

export async function createTodo(
	env: App.Platform['env'] | undefined,
	email: string,
	title: string,
	opts?: { detail?: string; deadline?: number; projectId?: string }
): Promise<void> {
	await write(
		env,
		'createTodo',
		(kv) => kvStore.createTodo(kv, email, title, opts),
		(db) => d1Store.createTodo(db, email, title, opts)
	);
}

export async function updateTodo(
	env: App.Platform['env'] | undefined,
	email: string,
	id: string,
	patch: { title?: string; detail?: string; deadline?: number | null }
): Promise<void> {
	await write(
		env,
		'updateTodo',
		(kv) => kvStore.updateTodo(kv, email, id, patch),
		(db) => d1Store.updateTodo(db, email, id, patch)
	);
}

export async function toggleTodo(env: App.Platform['env'] | undefined, email: string, id: string): Promise<void> {
	await write(env, 'toggleTodo', (kv) => kvStore.toggleTodo(kv, email, id), (db) => d1Store.toggleTodo(db, email, id));
}

export async function deleteTodo(env: App.Platform['env'] | undefined, email: string, id: string): Promise<void> {
	await write(env, 'deleteTodo', (kv) => kvStore.deleteTodo(kv, email, id), (db) => d1Store.deleteTodo(db, email, id));
}

export async function getLegacyTimer(
	env: App.Platform['env'] | undefined,
	email: string
): Promise<{ activeTaskId: string; startedAt: number } | null> {
	const kv = getKV(env);
	if (kv) return kvStore.getLegacyTimer(kv, email);

	return null;
}

export async function clearLegacyTimer(env: App.Platform['env'] | undefined, email: string): Promise<void> {
	const kv = getKV(env);
	if (kv) {
		await kvStore.clearLegacyTimer(kv, email);
		return;
	}
}

export async function getSettings(env: App.Platform['env'] | undefined, email: string): Promise<UserSettings> {
	return read(env, 'getSettings', (kv) => kvStore.getSettings(kv, email), (db) => d1Store.getSettings(db, email));
}

export async function saveSettings(
	env: App.Platform['env'] | undefined,
	email: string,
	settings: UserSettings
): Promise<void> {
	await write(
		env,
		'saveSettings',
		(kv) => kvStore.saveSettings(kv, email, settings),
		(db) => d1Store.saveSettings(db, email, settings)
	);
}

export async function archiveTodo(env: App.Platform['env'] | undefined, email: string, id: string): Promise<void> {
	await write(env, 'archiveTodo', (kv) => kvStore.archiveTodo(kv, email, id), (db) => d1Store.archiveTodo(db, email, id));
}

export async function unarchiveTodo(env: App.Platform['env'] | undefined, email: string, id: string): Promise<void> {
	await write(
		env,
		'unarchiveTodo',
		(kv) => kvStore.unarchiveTodo(kv, email, id),
		(db) => d1Store.unarchiveTodo(db, email, id)
	);
}

export async function addTaskLog(
	env: App.Platform['env'] | undefined,
	email: string,
	todoId: string,
	text: string
): Promise<void> {
	await write(
		env,
		'addTaskLog',
		(kv) => kvStore.addTaskLog(kv, email, todoId, text),
		(db) => d1Store.addTaskLog(db, email, todoId, text)
	);
}

export async function deleteTaskLog(
	env: App.Platform['env'] | undefined,
	email: string,
	todoId: string,
	logId: string
): Promise<void> {
	await write(
		env,
		'deleteTaskLog',
		(kv) => kvStore.deleteTaskLog(kv, email, todoId, logId),
		(db) => d1Store.deleteTaskLog(db, email, todoId, logId)
	);
}

export async function getProjects(env: App.Platform['env'] | undefined, email: string) {
	return read(env, 'getProjects', (kv) => kvStore.getProjects(kv, email), (db) => d1Store.getProjects(db, email));
}

export async function saveProjects(
	env: App.Platform['env'] | undefined,
	email: string,
	projects: Project[]
): Promise<void> {
	await write(
		env,
		'saveProjects',
		(kv) => kvStore.saveProjects(kv, email, projects),
		(db) => d1Store.saveProjects(db, email, projects)
	);
}

export async function updateProject(
	env: App.Platform['env'] | undefined,
	email: string,
	projectId: string,
	patch: { name?: string; detail?: string | null }
): Promise<void> {
	await write(
		env,
		'updateProject',
		(kv) => kvStore.updateProject(kv, email, projectId, patch),
		(db) => d1Store.updateProject(db, email, projectId, patch)
	);
}

export async function addProjectResource(
	env: App.Platform['env'] | undefined,
	email: string,
	projectId: string,
	url: string,
	label?: string
): Promise<void> {
	await write(
		env,
		'addProjectResource',
		(kv) => kvStore.addProjectResource(kv, email, projectId, url, label),
		(db) => d1Store.addProjectResource(db, email, projectId, url, label)
	);
}

export async function deleteProjectResource(
	env: App.Platform['env'] | undefined,
	email: string,
	projectId: string,
	resourceId: string
): Promise<void> {
	await write(
		env,
		'deleteProjectResource',
		(kv) => kvStore.deleteProjectResource(kv, email, projectId, resourceId),
		(db) => d1Store.deleteProjectResource(db, email, projectId, resourceId)
	);
}

export async function addProjectAttachment(
	env: App.Platform['env'] | undefined,
	email: string,
	projectId: string,
	attachment: Omit<ProjectAttachment, 'createdAt'>
): Promise<ProjectAttachment | null> {
	return write(
		env,
		'addProjectAttachment',
		(kv) => kvStore.addProjectAttachment(kv, email, projectId, attachment),
		(db) => d1Store.addProjectAttachment(db, email, projectId, attachment)
	);
}

export async function deleteProjectAttachment(
	env: App.Platform['env'] | undefined,
	email: string,
	projectId: string,
	attachmentId: string
): Promise<ProjectAttachment | null> {
	return write(
		env,
		'deleteProjectAttachment',
		(kv) => kvStore.deleteProjectAttachment(kv, email, projectId, attachmentId),
		(db) => d1Store.deleteProjectAttachment(db, email, projectId, attachmentId)
	);
}

export async function archiveProject(env: App.Platform['env'] | undefined, email: string, id: string): Promise<void> {
	await write(
		env,
		'archiveProject',
		(kv) => kvStore.archiveProject(kv, email, id),
		(db) => d1Store.archiveProject(db, email, id)
	);
}

export async function unarchiveProject(
	env: App.Platform['env'] | undefined,
	email: string,
	id: string
): Promise<void> {
	await write(
		env,
		'unarchiveProject',
		(kv) => kvStore.unarchiveProject(kv, email, id),
		(db) => d1Store.unarchiveProject(db, email, id)
	);
}

export async function getFocus(env: App.Platform['env'] | undefined, email: string): Promise<FocusState | null> {
	return read(env, 'getFocus', (kv) => kvStore.getFocus(kv, email), (db) => d1Store.getFocus(db, email));
}

export async function saveFocus(
	env: App.Platform['env'] | undefined,
	email: string,
	focus: FocusState | null
): Promise<void> {
	await write(env, 'saveFocus', (kv) => kvStore.saveFocus(kv, email, focus), (db) => d1Store.saveFocus(db, email, focus));
}

export async function getSessions(env: App.Platform['env'] | undefined, email: string) {
	return read(env, 'getSessions', (kv) => kvStore.getSessions(kv, email), (db) => d1Store.getSessions(db, email));
}

export async function saveSessions(env: App.Platform['env'] | undefined, email: string, sessions: FocusSession[]): Promise<void> {
	await write(
		env,
		'saveSessions',
		(kv) => kvStore.saveSessions(kv, email, sessions),
		(db) => d1Store.saveSessions(db, email, sessions)
	);
}

export async function endActiveSession(
	env: App.Platform['env'] | undefined,
	email: string,
	reason: FocusSession['endReason']
): Promise<void> {
	await write(
		env,
		'endActiveSession',
		(kv) => kvStore.endActiveSession(kv, email, reason),
		(db) => d1Store.endActiveSession(db, email, reason)
	);
}

export async function startSession(env: App.Platform['env'] | undefined, email: string, taskId: string): Promise<void> {
	await write(
		env,
		'startSession',
		(kv) => kvStore.startSession(kv, email, taskId),
		(db) => d1Store.startSession(db, email, taskId)
	);
}

export async function getGitHubInfo(
	env: App.Platform['env'] | undefined,
	email: string,
	repoLinkId: string
): Promise<GitHubRepoInfo | null> {
	const kv = getKV(env);
	if (!kv) return null;
	return kvStore.getGitHubInfo(kv, email, repoLinkId);
}

export async function saveGitHubInfo(
	env: App.Platform['env'] | undefined,
	email: string,
	repoLinkId: string,
	info: GitHubRepoInfo
): Promise<void> {
	await kvOnly(env, 'saveGitHubInfo', (kv) => kvStore.saveGitHubInfo(kv, email, repoLinkId, info));
}

export async function deleteGitHubInfo(
	env: App.Platform['env'] | undefined,
	email: string,
	repoLinkId: string
): Promise<void> {
	await kvOnly(env, 'deleteGitHubInfo', (kv) => kvStore.deleteGitHubInfo(kv, email, repoLinkId));
}

export async function focusTaskTx(env: App.Platform['env'] | undefined, email: string, taskId: string): Promise<void> {
	await mutateFocusState(env, email, 'focusTaskTx', ({ focus, sessions, todos, now }) => {
		const existing = getFocusedTask(focus, taskId);
		const nextFocus = upsertFocusedTask(focus, taskId, now);
		const nextTask = getFocusedTask(nextFocus, taskId);
		let nextSessions = sessions;
		if (!existing && nextTask?.sessionStartedAt) {
			nextSessions = ensureOpenSession(nextSessions, taskId, nextTask.sessionStartedAt);
		}
		return { focus: nextFocus, sessions: nextSessions, todos };
	});
}

export async function expandFocusTaskTx(
	env: App.Platform['env'] | undefined,
	email: string,
	taskId: string
): Promise<void> {
	await mutateFocusState(env, email, 'expandFocusTaskTx', ({ focus, sessions, todos, now }) => ({
		focus: expandFocusedTask(focus, taskId, now),
		sessions,
		todos
	}));
}

export async function stopFocusTaskTx(
	env: App.Platform['env'] | undefined,
	email: string,
	taskId: string,
	reason: FocusSession['endReason'] = 'manual'
): Promise<void> {
	await mutateFocusState(env, email, 'stopFocusTaskTx', ({ focus, sessions, todos, now }) => {
		const task = getFocusedTask(focus, taskId);
		if (task) {
			closeRunningInterval(sessions, todos, taskId, task.sessionStartedAt, reason, now);
		}
		return {
			focus: stopFocusedTask(focus, taskId),
			sessions,
			todos
		};
	});
}

export async function unfocusTx(
	env: App.Platform['env'] | undefined,
	email: string,
	reason: FocusSession['endReason']
): Promise<void> {
	await mutateFocusState(env, email, 'unfocusTx', ({ focus, sessions, todos, now }) => {
		for (const task of focus?.tasks ?? []) {
			closeRunningInterval(sessions, todos, task.taskId, task.sessionStartedAt, reason, now);
		}
		return { focus: null, sessions, todos };
	});
}

export async function toggleTodoAndHandleFocusTx(
	env: App.Platform['env'] | undefined,
	email: string,
	id: string
): Promise<void> {
	await mutateFocusState(env, email, 'toggleTodoAndHandleFocusTx', ({ focus, sessions, todos, now }) => {
		const todo = todos.find((task) => task.id === id);
		if (!todo) return { focus, sessions, todos };

		todo.done = !todo.done;

		if (todo.done) {
			const focusedTask = getFocusedTask(focus, id);
			if (focusedTask) {
				closeRunningInterval(sessions, todos, id, focusedTask.sessionStartedAt, 'done', now);
			}
			focus = removeFocusedTask(focus, id);
		}

		return { focus, sessions, todos };
	});
}

export async function deleteProjectCascadeTx(
	env: App.Platform['env'] | undefined,
	email: string,
	projectId: string
): Promise<{ attachmentKeys: string[] }> {
	return write(
		env,
		'deleteProjectCascadeTx',
		async (kv) => {
			const projects = await kvStore.getProjects(kv, email);
			const deletedProject = projects.find((p) => p.id === projectId);
			const attachmentKeys = (deletedProject?.attachments ?? [])
				.map((attachment) => attachment.key)
				.filter((key): key is string => Boolean(key));

			await kvStore.saveProjects(
				kv,
				email,
				projects.filter((project) => project.id !== projectId)
			);

			const todos = await kvStore.getTodos(kv, email);
			let changed = false;
			for (const todo of todos) {
				if (todo.projectId === projectId) {
					delete todo.projectId;
					changed = true;
				}
			}
			if (changed) await kvStore.saveTodos(kv, email, todos);

			return { attachmentKeys };
		},
		(db) => d1Store.deleteProjectCascadeTx(db, email, projectId)
	);
}

export function requireD1(env: App.Platform['env'] | undefined): D1Database {
	const d1 = getD1(env);
	if (!d1) throw new Error('D1 is not configured');
	return d1;
}

export function requireKV(env: App.Platform['env'] | undefined): KVNamespace {
	const kv = getKV(env);
	if (!kv) throw new Error('KV is not configured');
	return kv;
}
