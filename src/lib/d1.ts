import type {
	FocusSession,
	FocusState,
	GitHubRepoInfo,
	LegacyFocusState,
	Project,
	ProjectAttachment,
	ProjectGitHubRepo,
	Resource,
	TaskLog,
	Todo,
	UserSettings
} from './types';
import { DEFAULT_SETTINGS, THEMES } from './types';
import { normalizeFocusState } from './focus';
import { parseGitHubRepo } from './github';

function toBool(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0;
	if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
	return false;
}

function normalizeProject(project: Project): Project {
	const normalized: Project = {
		id: project.id,
		name: project.name,
		createdAt: project.createdAt
	};
	if (project.detail) normalized.detail = project.detail;
	if (project.resources && project.resources.length > 0) normalized.resources = project.resources;
	if (project.attachments && project.attachments.length > 0) normalized.attachments = project.attachments;
	const githubRepos = normalizeProjectGitHubRepos(project);
	if (githubRepos.length > 0) normalized.githubRepos = githubRepos;
	if (project.archived) normalized.archived = project.archived;
	if (project.archivedAt) normalized.archivedAt = project.archivedAt;
	return normalized;
}

function createLegacyProjectGitHubRepo(project: Project): ProjectGitHubRepo | null {
	const legacyRepo = (project as Project & { githubRepo?: string }).githubRepo;
	if (!legacyRepo) return null;

	const parsed = parseGitHubRepo(legacyRepo);
	if (!parsed) return null;

	return {
		id: `legacy:${project.id}:${parsed.owner}:${parsed.repo}`,
		projectId: project.id,
		fullName: `${parsed.owner}/${parsed.repo}`,
		owner: parsed.owner,
		repo: parsed.repo,
		isPrimary: true,
		createdAt: project.createdAt
	};
}

function normalizeProjectGitHubRepos(project: Project): ProjectGitHubRepo[] {
	const repos = project.githubRepos?.map((repo) => ({ ...repo, projectId: project.id })) ?? [];
	if (repos.length > 0) return repos;

	const legacyRepo = createLegacyProjectGitHubRepo(project);
	return legacyRepo ? [legacyRepo] : [];
}

type TodoRow = {
	id: string;
	title: string;
	done: number;
	created_at: number;
	detail: string | null;
	deadline: number | null;
	archived: number;
	archived_at: number | null;
	project_id: string | null;
	total_focus_ms: number | null;
};

type TaskLogRow = {
	id: string;
	todo_id: string;
	text: string;
	created_at: number;
};

type ProjectRow = {
	id: string;
	name: string;
	created_at: number;
	detail: string | null;
	github_repo: string | null;
	archived: number;
	archived_at: number | null;
};

type ProjectGitHubRepoRow = {
	id: string;
	project_id: string;
	full_name: string;
	owner: string;
	repo: string;
	is_primary: number;
	created_at: number;
};

type ResourceRow = {
	id: string;
	project_id: string;
	url: string;
	label: string | null;
	created_at: number;
};

type AttachmentRow = {
	id: string;
	project_id: string;
	name: string;
	url: string;
	key: string | null;
	content_type: string | null;
	size: number | null;
	created_at: number;
};

type FocusStateRow = {
	active_task_id: string;
	focused_at: number;
	session_paused: number | null;
	paused_at: number | null;
	accumulated_pause_ms: number | null;
	payload_json: string | null;
};

type FocusSessionRow = {
	id: string;
	task_id: string;
	started_at: number;
	ended_at: number | null;
	end_reason: FocusSession['endReason'] | null;
};

type ActiveSessionRow = {
	id: string;
	task_id: string;
	started_at: number;
};

function mapTodo(row: TodoRow, logs: TaskLog[]): Todo {
	const todo: Todo = {
		id: row.id,
		title: row.title,
		done: toBool(row.done),
		createdAt: row.created_at
	};
	if (row.detail) todo.detail = row.detail;
	if (row.deadline) todo.deadline = row.deadline;
	if (toBool(row.archived)) todo.archived = true;
	if (row.archived_at) todo.archivedAt = row.archived_at;
	if (logs.length > 0) todo.logs = logs;
	if (row.project_id) todo.projectId = row.project_id;
	if (row.total_focus_ms !== null && row.total_focus_ms !== undefined) {
		todo.totalFocusMs = row.total_focus_ms;
	}
	return todo;
}

export async function getTodos(db: D1Database, email: string): Promise<Todo[]> {
	const todoRows = await db
		.prepare(
			`SELECT id, title, done, created_at, detail, deadline, archived, archived_at, project_id, total_focus_ms
			 FROM todos
			 WHERE user_email = ?
			 ORDER BY created_at DESC`
		)
		.bind(email)
		.all<TodoRow>();
	const logRows = await db
		.prepare(
			`SELECT id, todo_id, text, created_at
			 FROM task_logs
			 WHERE user_email = ?
			 ORDER BY created_at ASC`
		)
		.bind(email)
		.all<TaskLogRow>();

	const logsByTodo = new Map<string, TaskLog[]>();
	for (const row of logRows.results) {
		const next: TaskLog = {
			id: row.id,
			text: row.text,
			createdAt: row.created_at
		};
		const arr = logsByTodo.get(row.todo_id) ?? [];
		arr.push(next);
		logsByTodo.set(row.todo_id, arr);
	}

	return todoRows.results.map((row) => mapTodo(row, logsByTodo.get(row.id) ?? []));
}

export async function saveTodos(db: D1Database, email: string, todos: Todo[]): Promise<void> {
	const statements: D1PreparedStatement[] = [
		db.prepare('DELETE FROM task_logs WHERE user_email = ?').bind(email),
		db.prepare('DELETE FROM todos WHERE user_email = ?').bind(email)
	];

	for (const todo of todos) {
		statements.push(
			db
				.prepare(
					`INSERT INTO todos (
						user_email, id, title, done, created_at, detail, deadline, archived, archived_at, project_id, total_focus_ms
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					email,
					todo.id,
					todo.title,
					todo.done ? 1 : 0,
					todo.createdAt,
					todo.detail ?? null,
					todo.deadline ?? null,
					todo.archived ? 1 : 0,
					todo.archivedAt ?? null,
					todo.projectId ?? null,
					todo.totalFocusMs ?? null
				)
		);

		for (const log of todo.logs ?? []) {
			statements.push(
				db
					.prepare('INSERT INTO task_logs (user_email, id, todo_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
					.bind(email, log.id, todo.id, log.text, log.createdAt)
			);
		}
	}

	await db.batch(statements);
}

export async function createTodo(
	db: D1Database,
	email: string,
	title: string,
	opts?: { detail?: string; deadline?: number; projectId?: string }
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO todos (
				user_email, id, title, done, created_at, detail, deadline, archived, archived_at, project_id, total_focus_ms
			)
			VALUES (?, ?, ?, 0, ?, ?, ?, 0, NULL, ?, NULL)`
		)
		.bind(email, crypto.randomUUID(), title, Date.now(), opts?.detail ?? null, opts?.deadline ?? null, opts?.projectId ?? null)
		.run();
}

export async function updateTodo(
	db: D1Database,
	email: string,
	id: string,
	patch: { title?: string; detail?: string; deadline?: number | null }
): Promise<void> {
	const sets: string[] = [];
	const values: Array<string | number | null> = [];

	if (patch.title !== undefined && patch.title) {
		sets.push('title = ?');
		values.push(patch.title);
	}

	if (patch.detail !== undefined) {
		sets.push('detail = ?');
		values.push(patch.detail || null);
	}

	if (patch.deadline !== undefined) {
		sets.push('deadline = ?');
		values.push(patch.deadline || null);
	}

	if (sets.length === 0) return;

	values.push(email, id);
	await db
		.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE user_email = ? AND id = ?`)
		.bind(...values)
		.run();
}

export async function toggleTodo(db: D1Database, email: string, id: string): Promise<void> {
	await db
		.prepare('UPDATE todos SET done = CASE done WHEN 1 THEN 0 ELSE 1 END WHERE user_email = ? AND id = ?')
		.bind(email, id)
		.run();
}

export async function deleteTodo(db: D1Database, email: string, id: string): Promise<void> {
	await db.batch([
		db.prepare('DELETE FROM task_logs WHERE user_email = ? AND todo_id = ?').bind(email, id),
		db.prepare('DELETE FROM todos WHERE user_email = ? AND id = ?').bind(email, id)
	]);
}

export async function getSettings(db: D1Database, email: string): Promise<UserSettings> {
	const row = await db
		.prepare('SELECT theme FROM user_settings WHERE user_email = ?')
		.bind(email)
		.first<{ theme: string | null }>();

	if (!row) return DEFAULT_SETTINGS;

	const theme = row.theme;

	return {
		theme: theme && THEMES.includes(theme as UserSettings['theme']) ? (theme as UserSettings['theme']) : DEFAULT_SETTINGS.theme
	};
}

export async function saveSettings(db: D1Database, email: string, settings: UserSettings): Promise<void> {
	await db
		.prepare(
			`INSERT INTO user_settings (user_email, work_ms, short_break_ms, long_break_ms, theme)
			 VALUES (?, NULL, NULL, NULL, ?)
			 ON CONFLICT(user_email) DO UPDATE SET
			 theme = excluded.theme`
		)
		.bind(email, settings.theme)
		.run();
}

export async function archiveTodo(db: D1Database, email: string, id: string): Promise<void> {
	await db
		.prepare('UPDATE todos SET archived = 1, archived_at = ? WHERE user_email = ? AND id = ?')
		.bind(Date.now(), email, id)
		.run();
}

export async function unarchiveTodo(db: D1Database, email: string, id: string): Promise<void> {
	await db
		.prepare('UPDATE todos SET archived = 0, archived_at = NULL, done = 0 WHERE user_email = ? AND id = ?')
		.bind(email, id)
		.run();
}

export async function addTaskLog(db: D1Database, email: string, todoId: string, text: string): Promise<void> {
	const todo = await db
		.prepare('SELECT id FROM todos WHERE user_email = ? AND id = ?')
		.bind(email, todoId)
		.first<{ id: string }>();
	if (!todo) return;

	await db
		.prepare('INSERT INTO task_logs (user_email, id, todo_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
		.bind(email, crypto.randomUUID(), todoId, text, Date.now())
		.run();
}

export async function deleteTaskLog(db: D1Database, email: string, todoId: string, logId: string): Promise<void> {
	await db
		.prepare('DELETE FROM task_logs WHERE user_email = ? AND todo_id = ? AND id = ?')
		.bind(email, todoId, logId)
		.run();
}

export async function getProjects(db: D1Database, email: string): Promise<Project[]> {
	const projectRows = await db
		.prepare(
			`SELECT id, name, created_at, detail, github_repo, archived, archived_at
			 FROM projects
			 WHERE user_email = ?
			 ORDER BY created_at ASC`
		)
		.bind(email)
		.all<ProjectRow>();
	const resourceRows = await db
		.prepare(
			`SELECT id, project_id, url, label, created_at
			 FROM project_resources
			 WHERE user_email = ?
			 ORDER BY created_at ASC`
		)
		.bind(email)
		.all<ResourceRow>();
	const attachmentRows = await db
		.prepare(
			`SELECT id, project_id, name, url, key, content_type, size, created_at
			 FROM project_attachments
			 WHERE user_email = ?
			 ORDER BY created_at ASC`
		)
		.bind(email)
		.all<AttachmentRow>();
	const githubRepoRows = await db
		.prepare(
			`SELECT id, project_id, full_name, owner, repo, is_primary, created_at
			 FROM project_github_repos
			 WHERE user_email = ?
			 ORDER BY created_at ASC`
		)
		.bind(email)
		.all<ProjectGitHubRepoRow>();

	const resourcesByProject = new Map<string, Resource[]>();
	for (const row of resourceRows.results) {
		const resource: Resource = {
			id: row.id,
			url: row.url,
			createdAt: row.created_at
		};
		if (row.label) resource.label = row.label;
		const arr = resourcesByProject.get(row.project_id) ?? [];
		arr.push(resource);
		resourcesByProject.set(row.project_id, arr);
	}

	const attachmentsByProject = new Map<string, ProjectAttachment[]>();
	for (const row of attachmentRows.results) {
		const attachment: ProjectAttachment = {
			id: row.id,
			name: row.name,
			url: row.url,
			createdAt: row.created_at
		};
		if (row.key) attachment.key = row.key;
		if (row.content_type) attachment.contentType = row.content_type;
		if (row.size !== null && row.size !== undefined) attachment.size = row.size;
		const arr = attachmentsByProject.get(row.project_id) ?? [];
		arr.push(attachment);
		attachmentsByProject.set(row.project_id, arr);
	}

	const githubReposByProject = new Map<string, ProjectGitHubRepo[]>();
	for (const row of githubRepoRows.results) {
		const repo: ProjectGitHubRepo = {
			id: row.id,
			projectId: row.project_id,
			fullName: row.full_name,
			owner: row.owner,
			repo: row.repo,
			isPrimary: toBool(row.is_primary),
			createdAt: row.created_at
		};
		const arr = githubReposByProject.get(row.project_id) ?? [];
		arr.push(repo);
		githubReposByProject.set(row.project_id, arr);
	}

	return projectRows.results.map((row) => {
		const project: Project = {
			id: row.id,
			name: row.name,
			createdAt: row.created_at
		};
		if (row.detail) project.detail = row.detail;
		const githubRepos = githubReposByProject.get(row.id);
		if (githubRepos && githubRepos.length > 0) project.githubRepos = githubRepos;
		else if (row.github_repo) {
			const legacyRepo = createLegacyProjectGitHubRepo({
				id: row.id,
				name: row.name,
				createdAt: row.created_at,
				detail: row.detail ?? undefined,
				githubRepo: row.github_repo
			} as Project & { githubRepo?: string });
			if (legacyRepo) project.githubRepos = [legacyRepo];
		}
		if (toBool(row.archived)) project.archived = true;
		if (row.archived_at) project.archivedAt = row.archived_at;
		const resources = resourcesByProject.get(row.id);
		if (resources && resources.length > 0) project.resources = resources;
		const attachments = attachmentsByProject.get(row.id);
		if (attachments && attachments.length > 0) project.attachments = attachments;
		return normalizeProject(project);
	});
}

export async function saveProjects(db: D1Database, email: string, projects: Project[]): Promise<void> {
	const statements: D1PreparedStatement[] = [
		db.prepare('DELETE FROM project_github_repos WHERE user_email = ?').bind(email),
		db.prepare('DELETE FROM project_resources WHERE user_email = ?').bind(email),
		db.prepare('DELETE FROM project_attachments WHERE user_email = ?').bind(email),
		db.prepare('DELETE FROM projects WHERE user_email = ?').bind(email)
	];

	for (const project of projects.map((p) => normalizeProject(p))) {
		statements.push(
			db
				.prepare(
					`INSERT INTO projects (user_email, id, name, created_at, detail, github_repo, archived, archived_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					email,
					project.id,
					project.name,
					project.createdAt,
					project.detail ?? null,
					null,
					project.archived ? 1 : 0,
					project.archivedAt ?? null
				)
		);

		for (const repo of project.githubRepos ?? []) {
			statements.push(
				db
					.prepare(
						`INSERT INTO project_github_repos (
						 user_email, id, project_id, full_name, owner, repo, is_primary, created_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.bind(
						email,
						repo.id,
						project.id,
						repo.fullName,
						repo.owner,
						repo.repo,
						repo.isPrimary ? 1 : 0,
						repo.createdAt
					)
			);
		}

		for (const resource of project.resources ?? []) {
			statements.push(
				db
					.prepare(
						'INSERT INTO project_resources (user_email, id, project_id, url, label, created_at) VALUES (?, ?, ?, ?, ?, ?)'
					)
					.bind(email, resource.id, project.id, resource.url, resource.label ?? null, resource.createdAt)
			);
		}

		for (const attachment of project.attachments ?? []) {
			statements.push(
				db
					.prepare(
						`INSERT INTO project_attachments (
						 user_email, id, project_id, name, url, key, content_type, size, created_at
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.bind(
						email,
						attachment.id,
						project.id,
						attachment.name,
						attachment.url,
						attachment.key ?? null,
						attachment.contentType ?? null,
						attachment.size ?? null,
						attachment.createdAt
					)
			);
		}
	}

	await db.batch(statements);
}

export async function updateProject(
	db: D1Database,
	email: string,
	projectId: string,
	patch: { name?: string; detail?: string | null }
): Promise<void> {
	const sets: string[] = [];
	const values: Array<string | null> = [];

	if (patch.name !== undefined && patch.name) {
		sets.push('name = ?');
		values.push(patch.name);
	}

	if (patch.detail !== undefined) {
		sets.push('detail = ?');
		values.push(patch.detail || null);
	}

	if (sets.length === 0) return;

	values.push(email, projectId);
	await db
		.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE user_email = ? AND id = ?`)
		.bind(...values)
		.run();
}

export async function addProjectResource(
	db: D1Database,
	email: string,
	projectId: string,
	url: string,
	label?: string
): Promise<void> {
	const project = await db
		.prepare('SELECT id FROM projects WHERE user_email = ? AND id = ?')
		.bind(email, projectId)
		.first<{ id: string }>();
	if (!project) return;

	await db
		.prepare('INSERT INTO project_resources (user_email, id, project_id, url, label, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(email, crypto.randomUUID(), projectId, url, label ?? null, Date.now())
		.run();
}

export async function deleteProjectResource(
	db: D1Database,
	email: string,
	projectId: string,
	resourceId: string
): Promise<void> {
	await db
		.prepare('DELETE FROM project_resources WHERE user_email = ? AND project_id = ? AND id = ?')
		.bind(email, projectId, resourceId)
		.run();
}

export async function addProjectAttachment(
	db: D1Database,
	email: string,
	projectId: string,
	attachment: Omit<ProjectAttachment, 'createdAt'>
): Promise<ProjectAttachment | null> {
	const project = await db
		.prepare('SELECT id FROM projects WHERE user_email = ? AND id = ?')
		.bind(email, projectId)
		.first<{ id: string }>();
	if (!project) return null;

	const createdAt = Date.now();
	await db
		.prepare(
			`INSERT INTO project_attachments (
			 user_email, id, project_id, name, url, key, content_type, size, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			email,
			attachment.id,
			projectId,
			attachment.name,
			attachment.url,
			attachment.key ?? null,
			attachment.contentType ?? null,
			attachment.size ?? null,
			createdAt
		)
		.run();

	return {
		...attachment,
		createdAt
	};
}

export async function deleteProjectAttachment(
	db: D1Database,
	email: string,
	projectId: string,
	attachmentId: string
): Promise<ProjectAttachment | null> {
	const row = await db
		.prepare(
			`SELECT id, name, url, key, content_type, size, created_at
			 FROM project_attachments
			 WHERE user_email = ? AND project_id = ? AND id = ?`
		)
		.bind(email, projectId, attachmentId)
		.first<{ id: string; name: string; url: string; key: string | null; content_type: string | null; size: number | null; created_at: number }>();

	if (!row) return null;

	await db
		.prepare('DELETE FROM project_attachments WHERE user_email = ? AND project_id = ? AND id = ?')
		.bind(email, projectId, attachmentId)
		.run();

	const attachment: ProjectAttachment = {
		id: row.id,
		name: row.name,
		url: row.url,
		createdAt: row.created_at
	};
	if (row.key) attachment.key = row.key;
	if (row.content_type) attachment.contentType = row.content_type;
	if (row.size !== null && row.size !== undefined) attachment.size = row.size;
	return attachment;
}

export async function archiveProject(db: D1Database, email: string, id: string): Promise<void> {
	await db
		.prepare('UPDATE projects SET archived = 1, archived_at = ? WHERE user_email = ? AND id = ?')
		.bind(Date.now(), email, id)
		.run();
}

export async function unarchiveProject(db: D1Database, email: string, id: string): Promise<void> {
	await db
		.prepare('UPDATE projects SET archived = 0, archived_at = NULL WHERE user_email = ? AND id = ?')
		.bind(email, id)
		.run();
}

export async function getFocus(db: D1Database, email: string): Promise<FocusState | null> {
	const row = await db
		.prepare(
			`SELECT
			 active_task_id,
			 focused_at,
			 session_paused,
			 paused_at,
			 accumulated_pause_ms,
			 payload_json
			 FROM focus_state
			 WHERE user_email = ?`
		)
		.bind(email)
		.first<FocusStateRow>();

	if (!row) return null;

	if (row.payload_json) {
		try {
			return normalizeFocusState(JSON.parse(row.payload_json) as FocusState);
		} catch {
			// Fall through to legacy columns.
		}
	}

	const legacy: LegacyFocusState = {
		activeTaskId: row.active_task_id,
		focusedAt: row.focused_at
	};
	if (row.session_paused !== null) legacy.sessionPaused = toBool(row.session_paused);
	if (row.paused_at !== null) legacy.pausedAt = row.paused_at;
	if (row.accumulated_pause_ms !== null) legacy.accumulatedPauseMs = row.accumulated_pause_ms;
	return normalizeFocusState(legacy);
}

export async function saveFocus(db: D1Database, email: string, focus: FocusState | null): Promise<void> {
	if (focus === null) {
		await db.prepare('DELETE FROM focus_state WHERE user_email = ?').bind(email).run();
		return;
	}

	const normalized = normalizeFocusState(focus);
	if (!normalized) {
		await db.prepare('DELETE FROM focus_state WHERE user_email = ?').bind(email).run();
		return;
	}

	const anchorTask =
		normalized.tasks.find((task) => task.taskId === normalized.expandedTaskId) ?? normalized.tasks[0];

	await db
		.prepare(
			`INSERT INTO focus_state (
			 user_email,
			 active_task_id,
			 focused_at,
			 session_paused,
			 paused_at,
			 accumulated_pause_ms,
			 payload_json
			) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_email) DO UPDATE SET
			 active_task_id = excluded.active_task_id,
			 focused_at = excluded.focused_at,
			 session_paused = excluded.session_paused,
			 paused_at = excluded.paused_at,
			 accumulated_pause_ms = excluded.accumulated_pause_ms,
			 payload_json = excluded.payload_json`
		)
		.bind(
			email,
			anchorTask.taskId,
			anchorTask.addedAt,
			anchorTask.sessionStatus === 'paused' ? 1 : 0,
			null,
			anchorTask.sessionElapsedMs,
			JSON.stringify(normalized)
		)
		.run();
}

export async function getSessions(db: D1Database, email: string): Promise<FocusSession[]> {
	const rows = await db
		.prepare(
			`SELECT id, task_id, started_at, ended_at, end_reason
			 FROM focus_sessions
			 WHERE user_email = ?
			 ORDER BY started_at ASC`
		)
		.bind(email)
		.all<FocusSessionRow>();

	return rows.results.map((row) => {
		const session: FocusSession = {
			id: row.id,
			taskId: row.task_id,
			startedAt: row.started_at
		};
		if (row.ended_at !== null) session.endedAt = row.ended_at;
		if (row.end_reason) session.endReason = row.end_reason;
		return session;
	});
}

export async function saveSessions(db: D1Database, email: string, sessions: FocusSession[]): Promise<void> {
	const statements: D1PreparedStatement[] = [
		db.prepare('DELETE FROM focus_sessions WHERE user_email = ?').bind(email)
	];
	for (const session of sessions) {
		statements.push(
			db
				.prepare(
					'INSERT INTO focus_sessions (user_email, id, task_id, started_at, ended_at, end_reason) VALUES (?, ?, ?, ?, ?, ?)'
				)
				.bind(
					email,
					session.id,
					session.taskId,
					session.startedAt,
					session.endedAt ?? null,
					session.endReason ?? null
				)
		);
	}
	await db.batch(statements);
}

export async function endActiveSession(
	db: D1Database,
	email: string,
	reason: FocusSession['endReason']
): Promise<void> {
	const active = await db
		.prepare(
			`SELECT id, task_id, started_at
			 FROM focus_sessions
			 WHERE user_email = ? AND ended_at IS NULL
			 ORDER BY started_at ASC
			 LIMIT 1`
		)
		.bind(email)
		.first<ActiveSessionRow>();

	if (!active) return;

	const endedAt = Date.now();
	const duration = endedAt - active.started_at;
	await db.batch([
		db
			.prepare('UPDATE focus_sessions SET ended_at = ?, end_reason = ? WHERE user_email = ? AND id = ?')
			.bind(endedAt, reason, email, active.id),
		db
			.prepare('UPDATE todos SET total_focus_ms = COALESCE(total_focus_ms, 0) + ? WHERE user_email = ? AND id = ?')
			.bind(duration, email, active.task_id)
	]);
}

export async function startSession(db: D1Database, email: string, taskId: string): Promise<void> {
	await db
		.prepare('INSERT INTO focus_sessions (user_email, id, task_id, started_at, ended_at, end_reason) VALUES (?, ?, ?, ?, NULL, NULL)')
		.bind(email, crypto.randomUUID(), taskId, Date.now())
		.run();
}

export async function getGitHubInfo(
	_db: D1Database,
	_email: string,
	_repoLinkId: string
): Promise<GitHubRepoInfo | null> {
	return null;
}

export async function saveGitHubInfo(
	_db: D1Database,
	_email: string,
	_repoLinkId: string,
	_info: GitHubRepoInfo
): Promise<void> {
	// GitHub cache remains in KV.
}

export async function deleteGitHubInfo(
	_db: D1Database,
	_email: string,
	_repoLinkId: string
): Promise<void> {
	// GitHub cache remains in KV.
}

export async function focusTaskTx(db: D1Database, email: string, taskId: string): Promise<void> {
	const now = Date.now();
	const active = await db
		.prepare(
			`SELECT id, task_id, started_at
			 FROM focus_sessions
			 WHERE user_email = ? AND ended_at IS NULL
			 ORDER BY started_at ASC
			 LIMIT 1`
		)
		.bind(email)
		.first<ActiveSessionRow>();

	const statements: D1PreparedStatement[] = [];
	if (active) {
		const duration = now - active.started_at;
		statements.push(
			db
				.prepare('UPDATE focus_sessions SET ended_at = ?, end_reason = ? WHERE user_email = ? AND id = ?')
				.bind(now, 'switch', email, active.id),
			db
				.prepare('UPDATE todos SET total_focus_ms = COALESCE(total_focus_ms, 0) + ? WHERE user_email = ? AND id = ?')
				.bind(duration, email, active.task_id)
		);
	}

	statements.push(
		db
			.prepare('INSERT INTO focus_sessions (user_email, id, task_id, started_at, ended_at, end_reason) VALUES (?, ?, ?, ?, NULL, NULL)')
			.bind(email, crypto.randomUUID(), taskId, now),
		db
			.prepare(
				`INSERT INTO focus_state (
				 user_email, active_task_id, focused_at, session_paused, paused_at, accumulated_pause_ms, payload_json
				) VALUES (?, ?, ?, 0, NULL, 0, ?)
				ON CONFLICT(user_email) DO UPDATE SET
				 active_task_id = excluded.active_task_id,
				 focused_at = excluded.focused_at,
				 session_paused = 0,
				 paused_at = NULL,
				 accumulated_pause_ms = 0,
				 payload_json = excluded.payload_json`
			)
			.bind(email, taskId, now, null)
	);

	await db.batch(statements);
}

export async function unfocusTx(
	db: D1Database,
	email: string,
	reason: FocusSession['endReason']
): Promise<void> {
	const now = Date.now();
	const active = await db
		.prepare(
			`SELECT id, task_id, started_at
			 FROM focus_sessions
			 WHERE user_email = ? AND ended_at IS NULL
			 ORDER BY started_at ASC
			 LIMIT 1`
		)
		.bind(email)
		.first<ActiveSessionRow>();

	const statements: D1PreparedStatement[] = [
		db.prepare('DELETE FROM focus_state WHERE user_email = ?').bind(email)
	];

	if (active) {
		const duration = now - active.started_at;
		statements.push(
			db
				.prepare('UPDATE focus_sessions SET ended_at = ?, end_reason = ? WHERE user_email = ? AND id = ?')
				.bind(now, reason, email, active.id),
			db
				.prepare('UPDATE todos SET total_focus_ms = COALESCE(total_focus_ms, 0) + ? WHERE user_email = ? AND id = ?')
				.bind(duration, email, active.task_id)
		);
	}

	await db.batch(statements);
}

export async function toggleTodoAndHandleFocusTx(db: D1Database, email: string, id: string): Promise<void> {
	const todo = await db
		.prepare('SELECT done FROM todos WHERE user_email = ? AND id = ?')
		.bind(email, id)
		.first<{ done: number }>();
	if (!todo) return;

	const toggledDone = todo.done ? 0 : 1;
	const now = Date.now();

	const statements: D1PreparedStatement[] = [
		db.prepare('UPDATE todos SET done = ? WHERE user_email = ? AND id = ?').bind(toggledDone, email, id)
	];

	if (toggledDone === 1) {
		const focus = await db
			.prepare('SELECT active_task_id FROM focus_state WHERE user_email = ?')
			.bind(email)
			.first<{ active_task_id: string }>();
		if (focus?.active_task_id === id) {
			const active = await db
				.prepare(
					`SELECT id, task_id, started_at
					 FROM focus_sessions
					 WHERE user_email = ? AND ended_at IS NULL
					 ORDER BY started_at ASC
					 LIMIT 1`
				)
				.bind(email)
				.first<ActiveSessionRow>();

			if (active) {
				const duration = now - active.started_at;
				statements.push(
					db
						.prepare('UPDATE focus_sessions SET ended_at = ?, end_reason = ? WHERE user_email = ? AND id = ?')
						.bind(now, 'done', email, active.id),
					db
						.prepare('UPDATE todos SET total_focus_ms = COALESCE(total_focus_ms, 0) + ? WHERE user_email = ? AND id = ?')
						.bind(duration, email, active.task_id)
				);
			}
			statements.push(db.prepare('DELETE FROM focus_state WHERE user_email = ?').bind(email));
		}
	}

	await db.batch(statements);
}

export async function deleteProjectCascadeTx(
	db: D1Database,
	email: string,
	projectId: string
): Promise<{ attachmentKeys: string[] }> {
	const attachmentRows = await db
		.prepare('SELECT key FROM project_attachments WHERE user_email = ? AND project_id = ? AND key IS NOT NULL')
		.bind(email, projectId)
		.all<{ key: string }>();
	const attachmentKeys = attachmentRows.results.map((row) => row.key);

	await db.batch([
		db.prepare('DELETE FROM project_resources WHERE user_email = ? AND project_id = ?').bind(email, projectId),
		db.prepare('DELETE FROM project_attachments WHERE user_email = ? AND project_id = ?').bind(email, projectId),
		db.prepare('DELETE FROM project_github_repos WHERE user_email = ? AND project_id = ?').bind(email, projectId),
		db.prepare('DELETE FROM projects WHERE user_email = ? AND id = ?').bind(email, projectId),
		db.prepare('UPDATE todos SET project_id = NULL WHERE user_email = ? AND project_id = ?').bind(email, projectId)
	]);

	return { attachmentKeys };
}
