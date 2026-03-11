import * as d1Store from './d1';
import * as kvStore from './kv';
import type {
	FocusSession,
	FocusState,
	GitHubRepoInfo,
	PomodoroLog,
	Project,
	ProjectAttachment,
	TimerState,
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

export async function getTimer(env: App.Platform['env'] | undefined, email: string): Promise<TimerState | null> {
	const kv = getKV(env);
	if (kv) return kvStore.getTimer(kv, email);

	const d1 = getD1(env);
	if (d1) return d1Store.getTimer(d1, email);

	return null;
}

export async function saveTimer(
	env: App.Platform['env'] | undefined,
	email: string,
	timer: TimerState | null
): Promise<void> {
	const kv = getKV(env);
	if (kv) {
		await kvStore.saveTimer(kv, email, timer);
		return;
	}

	const d1 = getD1(env);
	if (d1) await d1Store.saveTimer(d1, email, timer);
}

export async function logPomodoro(
	env: App.Platform['env'] | undefined,
	email: string,
	entry: Omit<PomodoroLog, 'completedAt'>
): Promise<void> {
	await write(
		env,
		'logPomodoro',
		(kv) => kvStore.logPomodoro(kv, email, entry),
		(db) => d1Store.logPomodoro(db, email, entry)
	);
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

export async function getPomodoroLogs(env: App.Platform['env'] | undefined, email: string): Promise<PomodoroLog[]> {
	return read(
		env,
		'getPomodoroLogs',
		(kv) => kvStore.getPomodoroLogs(kv, email),
		(db) => d1Store.getPomodoroLogs(db, email)
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
	projectId: string
): Promise<GitHubRepoInfo | null> {
	const kv = getKV(env);
	if (!kv) return null;
	return kvStore.getGitHubInfo(kv, email, projectId);
}

export async function saveGitHubInfo(
	env: App.Platform['env'] | undefined,
	email: string,
	projectId: string,
	info: GitHubRepoInfo
): Promise<void> {
	await kvOnly(env, 'saveGitHubInfo', (kv) => kvStore.saveGitHubInfo(kv, email, projectId, info));
}

export async function deleteGitHubInfo(
	env: App.Platform['env'] | undefined,
	email: string,
	projectId: string
): Promise<void> {
	await kvOnly(env, 'deleteGitHubInfo', (kv) => kvStore.deleteGitHubInfo(kv, email, projectId));
}

export async function focusTaskTx(env: App.Platform['env'] | undefined, email: string, taskId: string): Promise<void> {
	await write(
		env,
		'focusTaskTx',
		async (kv) => {
			await kvStore.endActiveSession(kv, email, 'switch');
			await kvStore.startSession(kv, email, taskId);
			await kvStore.saveFocus(kv, email, { activeTaskId: taskId, focusedAt: Date.now() });
		},
		(db) => d1Store.focusTaskTx(db, email, taskId)
	);
}

export async function unfocusTx(
	env: App.Platform['env'] | undefined,
	email: string,
	reason: FocusSession['endReason']
): Promise<void> {
	await write(
		env,
		'unfocusTx',
		async (kv) => {
			await kvStore.endActiveSession(kv, email, reason);
			await kvStore.saveFocus(kv, email, null);
		},
		(db) => d1Store.unfocusTx(db, email, reason)
	);
}

export async function toggleTodoAndHandleFocusTx(
	env: App.Platform['env'] | undefined,
	email: string,
	id: string
): Promise<void> {
	await write(
		env,
		'toggleTodoAndHandleFocusTx',
		async (kv) => {
			const todos = await kvStore.getTodos(kv, email);
			const todo = todos.find((t) => t.id === id);
			if (!todo) return;

			todo.done = !todo.done;
			await kvStore.saveTodos(kv, email, todos);

			if (todo.done) {
				const focus = await kvStore.getFocus(kv, email);
				if (focus?.activeTaskId === id) {
					await kvStore.endActiveSession(kv, email, 'done');
					await kvStore.saveFocus(kv, email, null);
				}
			}
		},
		(db) => d1Store.toggleTodoAndHandleFocusTx(db, email, id)
	);
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
