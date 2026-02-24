import type {
	Todo,
	PomodoroLog,
	TimerState,
	UserSettings,
	TaskLog,
	Resource,
	Project,
	ProjectAttachment,
	FocusState,
	FocusSession,
	GitHubRepoInfo
} from './types';
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
	opts?: { detail?: string; deadline?: number; projectId?: string }
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
	if (opts?.projectId) todo.projectId = opts.projectId;
	todos.unshift(todo);
	await saveTodos(kv, email, todos);
}

export async function updateTodo(
	kv: KVNamespace,
	email: string,
	id: string,
	patch: { title?: string; detail?: string; deadline?: number | null }
): Promise<void> {
	const todos = await getTodos(kv, email);
	const todo = todos.find((t) => t.id === id);
	if (!todo) return;
	if (patch.title !== undefined) {
		if (patch.title) {
			todo.title = patch.title;
		}
	}
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

// ── Projects ──

function normalizeProject(project: Project): Project {
	const normalized: Project = {
		id: project.id,
		name: project.name,
		createdAt: project.createdAt
	};
	if (project.detail) normalized.detail = project.detail;
	if (project.resources && project.resources.length > 0) normalized.resources = project.resources;
	if (project.attachments && project.attachments.length > 0) normalized.attachments = project.attachments;
	if (project.githubRepo) normalized.githubRepo = project.githubRepo;
	if (project.archived) normalized.archived = project.archived;
	if (project.archivedAt) normalized.archivedAt = project.archivedAt;
	return normalized;
}

export async function getProjects(kv: KVNamespace, email: string): Promise<Project[]> {
	const data = await kv.get(`projects:${email}`, 'json');
	const projects = (data as Project[]) ?? [];
	return projects.map((p) => normalizeProject(p));
}

export async function saveProjects(kv: KVNamespace, email: string, projects: Project[]): Promise<void> {
	await kv.put(`projects:${email}`, JSON.stringify(projects.map((p) => normalizeProject(p))));
}

export async function updateProject(
	kv: KVNamespace,
	email: string,
	projectId: string,
	patch: { name?: string; detail?: string | null }
): Promise<void> {
	const projects = await getProjects(kv, email);
	const project = projects.find((p) => p.id === projectId);
	if (!project) return;

	if (patch.name !== undefined) {
		if (patch.name) project.name = patch.name;
	}

	if (patch.detail !== undefined) {
		if (patch.detail) project.detail = patch.detail;
		else delete project.detail;
	}

	await saveProjects(kv, email, projects);
}

export async function addProjectResource(
	kv: KVNamespace,
	email: string,
	projectId: string,
	url: string,
	label?: string
): Promise<void> {
	const projects = await getProjects(kv, email);
	const project = projects.find((p) => p.id === projectId);
	if (!project) return;

	const resource: Resource = { id: crypto.randomUUID(), url, createdAt: Date.now() };
	if (label) resource.label = label;
	project.resources = [...(project.resources ?? []), resource];
	await saveProjects(kv, email, projects);
}

export async function deleteProjectResource(
	kv: KVNamespace,
	email: string,
	projectId: string,
	resourceId: string
): Promise<void> {
	const projects = await getProjects(kv, email);
	const project = projects.find((p) => p.id === projectId);
	if (!project || !project.resources) return;

	project.resources = project.resources.filter((r) => r.id !== resourceId);
	if (project.resources.length === 0) delete project.resources;
	await saveProjects(kv, email, projects);
}

export async function addProjectAttachment(
	kv: KVNamespace,
	email: string,
	projectId: string,
	attachment: Omit<ProjectAttachment, 'createdAt'>
): Promise<ProjectAttachment | null> {
	const projects = await getProjects(kv, email);
	const project = projects.find((p) => p.id === projectId);
	if (!project) return null;

	const nextAttachment: ProjectAttachment = {
		...attachment,
		createdAt: Date.now()
	};
	project.attachments = [...(project.attachments ?? []), nextAttachment];
	await saveProjects(kv, email, projects);
	return nextAttachment;
}

export async function deleteProjectAttachment(
	kv: KVNamespace,
	email: string,
	projectId: string,
	attachmentId: string
): Promise<ProjectAttachment | null> {
	const projects = await getProjects(kv, email);
	const project = projects.find((p) => p.id === projectId);
	if (!project || !project.attachments) return null;

	const attachment = project.attachments.find((a) => a.id === attachmentId) ?? null;
	project.attachments = project.attachments.filter((a) => a.id !== attachmentId);
	if (project.attachments.length === 0) delete project.attachments;
	await saveProjects(kv, email, projects);
	return attachment;
}

export async function archiveProject(kv: KVNamespace, email: string, id: string): Promise<void> {
	const projects = await getProjects(kv, email);
	const project = projects.find((p) => p.id === id);
	if (project) {
		project.archived = true;
		project.archivedAt = Date.now();
		await saveProjects(kv, email, projects);
	}
}

export async function unarchiveProject(kv: KVNamespace, email: string, id: string): Promise<void> {
	const projects = await getProjects(kv, email);
	const project = projects.find((p) => p.id === id);
	if (project) {
		delete project.archived;
		delete project.archivedAt;
		await saveProjects(kv, email, projects);
	}
}

// ── Focus state ──

export async function getFocus(kv: KVNamespace, email: string): Promise<FocusState | null> {
	const data = await kv.get(`focus:${email}`, 'json');
	return (data as FocusState) ?? null;
}

export async function saveFocus(kv: KVNamespace, email: string, focus: FocusState | null): Promise<void> {
	if (focus === null) {
		await kv.delete(`focus:${email}`);
	} else {
		await kv.put(`focus:${email}`, JSON.stringify(focus));
	}
}

// ── Focus sessions ──

export async function getSessions(kv: KVNamespace, email: string): Promise<FocusSession[]> {
	const data = await kv.get(`sessions:${email}`, 'json');
	return (data as FocusSession[]) ?? [];
}

export async function saveSessions(kv: KVNamespace, email: string, sessions: FocusSession[]): Promise<void> {
	await kv.put(`sessions:${email}`, JSON.stringify(sessions));
}

export async function endActiveSession(
	kv: KVNamespace,
	email: string,
	reason: FocusSession['endReason']
): Promise<void> {
	const sessions = await getSessions(kv, email);
	const active = sessions.find((s) => !s.endedAt);
	if (!active) return;

	active.endedAt = Date.now();
	active.endReason = reason;
	await saveSessions(kv, email, sessions);

	// Update totalFocusMs on the task
	const duration = active.endedAt - active.startedAt;
	const todos = await getTodos(kv, email);
	const todo = todos.find((t) => t.id === active.taskId);
	if (todo) {
		todo.totalFocusMs = (todo.totalFocusMs ?? 0) + duration;
		await saveTodos(kv, email, todos);
	}
}

export async function startSession(kv: KVNamespace, email: string, taskId: string): Promise<void> {
	const sessions = await getSessions(kv, email);
	sessions.push({
		id: crypto.randomUUID(),
		taskId,
		startedAt: Date.now()
	});
	await saveSessions(kv, email, sessions);
}

// ── GitHub info cache ──

export async function getGitHubInfo(
	kv: KVNamespace,
	email: string,
	projectId: string
): Promise<GitHubRepoInfo | null> {
	const data = await kv.get(`github:${email}:${projectId}`, 'json');
	return (data as GitHubRepoInfo) ?? null;
}

export async function saveGitHubInfo(
	kv: KVNamespace,
	email: string,
	projectId: string,
	info: GitHubRepoInfo
): Promise<void> {
	await kv.put(`github:${email}:${projectId}`, JSON.stringify(info), { expirationTtl: 900 });
}

export async function deleteGitHubInfo(
	kv: KVNamespace,
	email: string,
	projectId: string
): Promise<void> {
	await kv.delete(`github:${email}:${projectId}`);
}
