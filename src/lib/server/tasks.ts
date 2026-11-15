import { nextOccurrence, parseRecurrence } from '$lib/recurrence';
import { parseQuickAdd } from '$lib/quickadd';
import {
	isProjectColor,
	type Comment,
	type LabelSummary,
	type Priority,
	type Task,
	type TaskDetail
} from '$lib/types';
import type { ServiceContext } from './context';
import { forbidden, invalid, notFound } from './errors';
import { listMembers, listProjects, listSections, requireEditor } from './projects';
import * as v from './validate';

const LABEL_SEPARATOR = '\u001f';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

type TaskRow = {
	id: string;
	project_id: string;
	section_id: string | null;
	parent_id: string | null;
	title: string;
	notes: string | null;
	priority: number;
	due_date: string | null;
	due_time: string | null;
	recurrence: string | null;
	assignee_email: string | null;
	sort_order: number;
	completed_at: number | null;
	completed_by: string | null;
	created_by: string;
	created_at: number;
	updated_at: number;
	project_name: string;
	project_color: string;
	labels: string | null;
	subtask_count: number;
	subtask_done_count: number;
	comment_count: number;
};

const TASK_SELECT = `
	SELECT t.id, t.project_id, t.section_id, t.parent_id, t.title, t.notes, t.priority, t.due_date, t.due_time,
		t.recurrence, t.assignee_email, t.sort_order, t.completed_at, t.completed_by, t.created_by, t.created_at,
		t.updated_at, p.name AS project_name, p.color AS project_color,
		(SELECT group_concat(l.name, char(31)) FROM task_labels l WHERE l.task_id = t.id) AS labels,
		(SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id) AS subtask_count,
		(SELECT COUNT(*) FROM tasks c WHERE c.parent_id = t.id AND c.completed_at IS NOT NULL) AS subtask_done_count,
		(SELECT COUNT(*) FROM comments k WHERE k.task_id = t.id) AS comment_count
	FROM tasks t
	JOIN projects p ON p.id = t.project_id
	JOIN project_members m ON m.project_id = t.project_id AND m.email = ?
	LEFT JOIN sections s ON s.id = t.section_id`;

function mapTask(row: TaskRow): Task {
	return {
		id: row.id,
		projectId: row.project_id,
		projectName: row.project_name,
		projectColor: isProjectColor(row.project_color) ? row.project_color : 'grey',
		sectionId: row.section_id,
		parentId: row.parent_id,
		title: row.title,
		notes: row.notes,
		priority: row.priority as Priority,
		dueDate: row.due_date,
		dueTime: row.due_time,
		recurrence: row.recurrence,
		assigneeEmail: row.assignee_email,
		sortOrder: row.sort_order,
		completedAt: row.completed_at,
		completedBy: row.completed_by,
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		labels: row.labels ? row.labels.split(LABEL_SEPARATOR).sort((a, b) => a.localeCompare(b)) : [],
		subtaskCount: row.subtask_count,
		subtaskDoneCount: row.subtask_done_count,
		commentCount: row.comment_count
	};
}

export interface TaskFilter {
	projectId?: string;
	/** null = tasks without a section. */
	sectionId?: string | null;
	/** null = top-level tasks only. Omit for any level. */
	parentId?: string | null;
	label?: string;
	search?: string;
	dueOnOrBefore?: string;
	dueOnOrAfter?: string;
	hasDueDate?: boolean;
	assigneeEmail?: string;
	status?: 'open' | 'completed' | 'all';
	completedSince?: number;
	order?: 'project' | 'due' | 'completed';
	limit?: number;
}

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function listTasks(ctx: ServiceContext, filter: TaskFilter = {}): Promise<Task[]> {
	const where: string[] = [];
	const params: unknown[] = [ctx.user.email];

	if (filter.projectId) {
		where.push('t.project_id = ?');
		params.push(filter.projectId);
	} else {
		where.push('p.archived_at IS NULL');
	}
	if (filter.sectionId !== undefined) {
		if (filter.sectionId === null) where.push('t.section_id IS NULL');
		else {
			where.push('t.section_id = ?');
			params.push(filter.sectionId);
		}
	}
	if (filter.parentId !== undefined) {
		if (filter.parentId === null) where.push('t.parent_id IS NULL');
		else {
			where.push('t.parent_id = ?');
			params.push(filter.parentId);
		}
	}
	if (filter.label) {
		where.push('EXISTS (SELECT 1 FROM task_labels l WHERE l.task_id = t.id AND l.name = ?)');
		params.push(filter.label.replace(/^@/, ''));
	}
	if (filter.search) {
		const pattern = `%${escapeLike(filter.search.trim())}%`;
		where.push(`(t.title LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\')`);
		params.push(pattern, pattern);
	}
	if (filter.dueOnOrBefore) {
		where.push('t.due_date IS NOT NULL AND t.due_date <= ?');
		params.push(filter.dueOnOrBefore);
	}
	if (filter.dueOnOrAfter) {
		where.push('t.due_date IS NOT NULL AND t.due_date >= ?');
		params.push(filter.dueOnOrAfter);
	}
	if (filter.hasDueDate !== undefined) {
		where.push(filter.hasDueDate ? 't.due_date IS NOT NULL' : 't.due_date IS NULL');
	}
	if (filter.assigneeEmail) {
		where.push('t.assignee_email = ?');
		params.push(filter.assigneeEmail.toLowerCase());
	}
	const status = filter.status ?? 'open';
	if (status === 'open') where.push('t.completed_at IS NULL');
	if (status === 'completed') where.push('t.completed_at IS NOT NULL');
	if (filter.completedSince !== undefined) {
		where.push('t.completed_at >= ?');
		params.push(filter.completedSince);
	}

	const order = {
		project: 'COALESCE(s.sort_order, -1) ASC, t.sort_order ASC, t.created_at ASC',
		due: 't.due_date ASC, (t.due_time IS NULL) ASC, t.due_time ASC, t.priority ASC, t.sort_order ASC',
		completed: 't.completed_at DESC'
	}[filter.order ?? 'project'];

	const limit = Math.min(Math.max(1, Math.floor(filter.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
	params.push(limit);

	const sql = `${TASK_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`;
	const rows = await ctx.db
		.prepare(sql)
		.bind(...params)
		.all<TaskRow>();
	return rows.results.map(mapTask);
}

export async function getTask(ctx: ServiceContext, taskId: string): Promise<Task> {
	const row = await ctx.db.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(ctx.user.email, taskId).first<TaskRow>();
	if (!row) throw notFound('Task');
	return mapTask(row);
}

export async function getTaskDetail(ctx: ServiceContext, taskId: string): Promise<TaskDetail> {
	const task = await getTask(ctx, taskId);
	const [parent, subtasks, comments, sections, members] = await Promise.all([
		task.parentId ? getTask(ctx, task.parentId) : Promise.resolve(null),
		listTasks(ctx, { projectId: task.projectId, parentId: task.id, status: 'all' }),
		listComments(ctx, task.id),
		listSections(ctx.db, task.projectId),
		listMembers(ctx.db, task.projectId)
	]);
	return { task, parent, subtasks, comments, sections, members };
}

export interface TaskInput {
	title: unknown;
	notes?: unknown;
	projectId?: string | null;
	sectionId?: string | null;
	parentId?: string | null;
	priority?: unknown;
	dueDate?: string | null;
	dueTime?: string | null;
	recurrence?: string | null;
	labels?: unknown;
	assigneeEmail?: string | null;
}

async function requireTaskEditor(ctx: ServiceContext, taskId: string): Promise<Task> {
	const task = await getTask(ctx, taskId);
	await requireEditor(ctx, task.projectId);
	return task;
}

async function assertSectionInProject(ctx: ServiceContext, sectionId: string, projectId: string) {
	const row = await ctx.db
		.prepare('SELECT 1 AS ok FROM sections WHERE id = ? AND project_id = ?')
		.bind(sectionId, projectId)
		.first();
	if (!row) throw invalid('That section does not belong to the project');
}

async function assertAssignable(ctx: ServiceContext, assigneeEmail: string, projectId: string): Promise<string> {
	const normalized = v.email(assigneeEmail);
	const row = await ctx.db
		.prepare('SELECT 1 AS ok FROM project_members WHERE project_id = ? AND email = ?')
		.bind(projectId, normalized)
		.first();
	if (!row) throw invalid('Tasks can only be assigned to project members');
	return normalized;
}

function reopenStatement(ctx: ServiceContext, taskId: string, now: number): D1PreparedStatement {
	return ctx.db
		.prepare('UPDATE tasks SET completed_at = NULL, completed_by = NULL, updated_at = ? WHERE id = ?')
		.bind(now, taskId);
}

function labelStatements(ctx: ServiceContext, taskId: string, labels: string[]): D1PreparedStatement[] {
	return [
		ctx.db.prepare('DELETE FROM task_labels WHERE task_id = ?').bind(taskId),
		...labels.map((name) => ctx.db.prepare('INSERT OR IGNORE INTO task_labels (task_id, name) VALUES (?, ?)').bind(taskId, name))
	];
}

export async function createTask(ctx: ServiceContext, input: TaskInput): Promise<Task> {
	const title = v.requiredText(input.title, 'Title', v.LIMITS.title);
	const notes = v.optionalText(input.notes, 'Notes', v.LIMITS.notes);
	const priority = input.priority === undefined || input.priority === null ? 4 : v.priority(input.priority);
	const labels = input.labels === undefined ? [] : v.labels(input.labels);

	let projectId = input.projectId || ctx.user.inboxProjectId;
	let sectionId = input.sectionId || null;
	let parentId: string | null = null;
	let reopenParent = false;

	if (input.parentId) {
		const parent = await getTask(ctx, input.parentId);
		if (parent.parentId) throw invalid('Subtasks cannot have their own subtasks');
		parentId = parent.id;
		// An open subtask under a completed parent would be hidden, so the parent reopens.
		reopenParent = Boolean(parent.completedAt);
		projectId = parent.projectId;
		sectionId = parent.sectionId;
	}

	await requireEditor(ctx, projectId);
	if (sectionId && !input.parentId) await assertSectionInProject(ctx, sectionId, projectId);

	const due = v.schedule(
		{ dueDate: input.dueDate ?? null, dueTime: input.dueTime ?? null, recurrence: input.recurrence ?? null },
		ctx.today
	);
	const assignee = input.assigneeEmail ? await assertAssignable(ctx, input.assigneeEmail, projectId) : null;

	const id = crypto.randomUUID();
	const now = Date.now();
	await ctx.db.batch([
		ctx.db
			.prepare(
				`INSERT INTO tasks (id, project_id, section_id, parent_id, title, notes, priority, due_date, due_time,
					recurrence, assignee_email, sort_order, created_by, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
					(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE project_id = ?), ?, ?, ?)`
			)
			.bind(
				id,
				projectId,
				sectionId,
				parentId,
				title,
				notes,
				priority,
				due.dueDate,
				due.dueTime,
				due.recurrence,
				assignee,
				projectId,
				ctx.user.email,
				now,
				now
			),
		...labelStatements(ctx, id, labels).slice(1),
		...(reopenParent && parentId ? [reopenStatement(ctx, parentId, now)] : [])
	]);

	return getTask(ctx, id);
}

export interface QuickAddDefaults {
	projectId?: string | null;
	sectionId?: string | null;
	parentId?: string | null;
	dueDate?: string | null;
}

/** Creates a task from natural language such as "Pay rent every month p1 #Home @bills". */
export async function quickAddTask(ctx: ServiceContext, text: unknown, defaults: QuickAddDefaults = {}): Promise<Task> {
	const raw = v.requiredText(text, 'Task', v.LIMITS.title * 2);
	const projects = await listProjects(ctx);
	const parsed = parseQuickAdd(raw, { today: ctx.today, projects });
	if (!parsed.title) throw invalid('The task needs a title as well as its date, project or labels');

	const projectChanged = Boolean(parsed.projectId && parsed.projectId !== defaults.projectId);
	return createTask(ctx, {
		title: parsed.title,
		projectId: parsed.projectId ?? defaults.projectId ?? null,
		sectionId: projectChanged ? null : (defaults.sectionId ?? null),
		parentId: projectChanged ? null : (defaults.parentId ?? null),
		priority: parsed.priority ?? undefined,
		dueDate: parsed.dueDate ?? (parsed.recurrence ? null : (defaults.dueDate ?? null)),
		dueTime: parsed.dueTime,
		recurrence: parsed.recurrence,
		labels: parsed.labels
	});
}

export interface TaskPatch {
	title?: unknown;
	notes?: unknown;
	priority?: unknown;
	dueDate?: string | null;
	dueTime?: string | null;
	recurrence?: string | null;
	labels?: unknown;
	assigneeEmail?: string | null;
}

export async function updateTask(ctx: ServiceContext, taskId: string, patch: TaskPatch): Promise<Task> {
	const task = await requireTaskEditor(ctx, taskId);

	const title = patch.title === undefined ? task.title : v.requiredText(patch.title, 'Title', v.LIMITS.title);
	const notes = patch.notes === undefined ? task.notes : v.optionalText(patch.notes, 'Notes', v.LIMITS.notes);
	const priority = patch.priority === undefined ? task.priority : v.priority(patch.priority);
	const dueDate = patch.dueDate === undefined ? task.dueDate : patch.dueDate;
	const clearingDate = patch.dueDate === null;
	const due = v.schedule(
		{
			dueDate,
			dueTime: patch.dueTime !== undefined ? patch.dueTime : clearingDate ? null : task.dueTime,
			recurrence: patch.recurrence !== undefined ? patch.recurrence : clearingDate ? null : task.recurrence
		},
		ctx.today
	);

	let assignee = task.assigneeEmail;
	if (patch.assigneeEmail !== undefined) {
		assignee = patch.assigneeEmail ? await assertAssignable(ctx, patch.assigneeEmail, task.projectId) : null;
	}

	const statements = [
		ctx.db
			.prepare(
				`UPDATE tasks SET title = ?, notes = ?, priority = ?, due_date = ?, due_time = ?, recurrence = ?,
					assignee_email = ?, updated_at = ? WHERE id = ?`
			)
			.bind(title, notes, priority, due.dueDate, due.dueTime, due.recurrence, assignee, Date.now(), taskId)
	];
	if (patch.labels !== undefined) statements.push(...labelStatements(ctx, taskId, v.labels(patch.labels)));
	await ctx.db.batch(statements);

	return getTask(ctx, taskId);
}

export interface CompleteResult {
	task: Task;
	/** True when a recurring task moved to its next date instead of being completed. */
	recurred: boolean;
}

export async function completeTask(ctx: ServiceContext, taskId: string): Promise<CompleteResult> {
	const task = await requireTaskEditor(ctx, taskId);
	if (task.completedAt) return { task, recurred: false };
	const now = Date.now();

	const rule = task.recurrence && task.dueDate ? parseRecurrence(task.recurrence) : null;
	if (rule && task.dueDate) {
		let next = nextOccurrence(rule, task.dueDate);
		for (let guard = 0; next <= ctx.today && guard < 5000; guard++) next = nextOccurrence(rule, next);

		await ctx.db.batch([
			ctx.db.prepare('UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?').bind(next, now, taskId),
			// A recurring task's checklist starts fresh each time.
			ctx.db
				.prepare('UPDATE tasks SET completed_at = NULL, completed_by = NULL, updated_at = ? WHERE parent_id = ?')
				.bind(now, taskId)
		]);
		return { task: await getTask(ctx, taskId), recurred: true };
	}

	await ctx.db.batch([
		ctx.db
			.prepare('UPDATE tasks SET completed_at = ?, completed_by = ?, updated_at = ? WHERE id = ?')
			.bind(now, ctx.user.email, now, taskId),
		ctx.db
			.prepare(
				`UPDATE tasks SET completed_at = ?, completed_by = ?, updated_at = ?
				 WHERE parent_id = ? AND completed_at IS NULL`
			)
			.bind(now, ctx.user.email, now, taskId)
	]);
	return { task: await getTask(ctx, taskId), recurred: false };
}

export async function reopenTask(ctx: ServiceContext, taskId: string): Promise<Task> {
	const task = await requireTaskEditor(ctx, taskId);
	const now = Date.now();
	const statements = [reopenStatement(ctx, taskId, now)];
	if (task.parentId) statements.push(reopenStatement(ctx, task.parentId, now));
	await ctx.db.batch(statements);
	return getTask(ctx, taskId);
}

export interface MoveInput {
	projectId?: string;
	/** null removes the section. */
	sectionId?: string | null;
	/** null makes it a top-level task. */
	parentId?: string | null;
}

export async function moveTask(ctx: ServiceContext, taskId: string, input: MoveInput): Promise<Task> {
	const task = await requireTaskEditor(ctx, taskId);

	let parentId = input.parentId === undefined ? task.parentId : input.parentId;
	let projectId = input.projectId ?? task.projectId;
	let sectionId = input.sectionId !== undefined ? input.sectionId : projectId === task.projectId ? task.sectionId : null;
	let reopenParent = false;

	if (input.parentId) {
		if (input.parentId === task.id) throw invalid('A task cannot be its own subtask');
		const parent = await getTask(ctx, input.parentId);
		if (parent.parentId) throw invalid('Subtasks cannot have their own subtasks');
		if (task.subtaskCount > 0) throw invalid('A task with subtasks cannot become a subtask');
		parentId = parent.id;
		projectId = parent.projectId;
		sectionId = parent.sectionId;
		reopenParent = Boolean(parent.completedAt) && !task.completedAt;
	} else if (
		task.parentId &&
		input.parentId === undefined &&
		(projectId !== task.projectId || (input.sectionId !== undefined && input.sectionId !== task.sectionId))
	) {
		// Moving a subtask to another project or section on its own detaches it from the parent.
		parentId = null;
	}

	if (projectId !== task.projectId) await requireEditor(ctx, projectId);
	if (sectionId && !input.parentId) await assertSectionInProject(ctx, sectionId, projectId);

	let assignee = task.assigneeEmail;
	if (assignee && projectId !== task.projectId) {
		const stillMember = await ctx.db
			.prepare('SELECT 1 AS ok FROM project_members WHERE project_id = ? AND email = ?')
			.bind(projectId, assignee)
			.first();
		if (!stillMember) assignee = null;
	}

	const now = Date.now();
	const projectChanged = projectId !== task.projectId;
	await ctx.db.batch([
		ctx.db
			.prepare(
				`UPDATE tasks SET project_id = ?, section_id = ?, parent_id = ?, assignee_email = ?, updated_at = ?,
					sort_order = CASE WHEN ? THEN (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE project_id = ?) ELSE sort_order END
				 WHERE id = ?`
			)
			.bind(projectId, sectionId, parentId, assignee, now, projectChanged ? 1 : 0, projectId, taskId),
		// Subtasks follow their parent.
		ctx.db
			.prepare(
				`UPDATE tasks SET project_id = ?, section_id = ?, updated_at = ?,
					assignee_email = CASE WHEN ? THEN NULL ELSE assignee_email END
				 WHERE parent_id = ?`
			)
			.bind(projectId, sectionId, now, projectChanged ? 1 : 0, taskId),
		...(reopenParent && parentId ? [reopenStatement(ctx, parentId, now)] : [])
	]);

	return getTask(ctx, taskId);
}

/** Applies a drag-and-drop order to top-level tasks within one section of a project. */
export async function reorderTasks(
	ctx: ServiceContext,
	projectId: string,
	sectionId: string | null,
	orderedIds: string[]
): Promise<void> {
	await requireEditor(ctx, projectId);
	if (orderedIds.length === 0) return;
	if (orderedIds.length > MAX_LIMIT) throw invalid('Too many tasks to reorder at once');
	if (sectionId) await assertSectionInProject(ctx, sectionId, projectId);

	const now = Date.now();
	await ctx.db.batch(
		orderedIds.flatMap((id, index) => [
			ctx.db
				.prepare(
					`UPDATE tasks SET sort_order = ?, section_id = ?, updated_at = ?
					 WHERE id = ? AND project_id = ? AND parent_id IS NULL`
				)
				.bind(index + 1, sectionId, now, id, projectId),
			ctx.db.prepare('UPDATE tasks SET section_id = ? WHERE parent_id = ? AND project_id = ?').bind(sectionId, id, projectId)
		])
	);
}

export async function deleteTask(ctx: ServiceContext, taskId: string): Promise<void> {
	await requireTaskEditor(ctx, taskId);
	await ctx.db.prepare('DELETE FROM tasks WHERE id = ?').bind(taskId).run();
}

export async function listComments(ctx: ServiceContext, taskId: string): Promise<Comment[]> {
	const rows = await ctx.db
		.prepare(
			`SELECT c.id, c.task_id, c.author_email, c.body, c.created_at
			 FROM comments c
			 JOIN tasks t ON t.id = c.task_id
			 JOIN project_members m ON m.project_id = t.project_id AND m.email = ?
			 WHERE c.task_id = ? ORDER BY c.created_at ASC`
		)
		.bind(ctx.user.email, taskId)
		.all<{ id: string; task_id: string; author_email: string; body: string; created_at: number }>();
	return rows.results.map((row) => ({
		id: row.id,
		taskId: row.task_id,
		authorEmail: row.author_email,
		body: row.body,
		createdAt: row.created_at
	}));
}

export async function addComment(ctx: ServiceContext, taskId: string, rawBody: unknown): Promise<Comment> {
	await requireTaskEditor(ctx, taskId);
	const body = v.optionalText(rawBody, 'Comment', v.LIMITS.comment);
	if (!body) throw invalid('Comment is empty');
	const comment: Comment = {
		id: crypto.randomUUID(),
		taskId,
		authorEmail: ctx.user.email,
		body,
		createdAt: Date.now()
	};
	await ctx.db
		.prepare('INSERT INTO comments (id, task_id, author_email, body, created_at) VALUES (?, ?, ?, ?, ?)')
		.bind(comment.id, taskId, comment.authorEmail, body, comment.createdAt)
		.run();
	return comment;
}

/** Authors can delete their own comments. Project owners can delete any comment. */
export async function deleteComment(ctx: ServiceContext, commentId: string): Promise<void> {
	const row = await ctx.db
		.prepare(
			`SELECT c.author_email, m.role, p.archived_at FROM comments c
			 JOIN tasks t ON t.id = c.task_id
			 JOIN projects p ON p.id = t.project_id
			 JOIN project_members m ON m.project_id = t.project_id AND m.email = ?
			 WHERE c.id = ?`
		)
		.bind(ctx.user.email, commentId)
		.first<{ author_email: string; role: string; archived_at: number | null }>();
	if (!row) throw notFound('Comment');
	if (row.archived_at) throw invalid('This project is archived. Unarchive it to make changes.');
	if (row.author_email !== ctx.user.email && row.role !== 'owner') {
		throw forbidden('You can only delete your own comments');
	}
	await ctx.db.prepare('DELETE FROM comments WHERE id = ?').bind(commentId).run();
}

export async function listLabels(ctx: ServiceContext): Promise<LabelSummary[]> {
	const rows = await ctx.db
		.prepare(
			`SELECT MIN(l.name) AS name, SUM(CASE WHEN t.completed_at IS NULL THEN 1 ELSE 0 END) AS open_count
			 FROM task_labels l
			 JOIN tasks t ON t.id = l.task_id
			 JOIN projects p ON p.id = t.project_id AND p.archived_at IS NULL
			 JOIN project_members m ON m.project_id = t.project_id AND m.email = ?
			 GROUP BY l.name COLLATE NOCASE
			 ORDER BY l.name COLLATE NOCASE`
		)
		.bind(ctx.user.email)
		.all<{ name: string; open_count: number }>();
	return rows.results.map((row) => ({ name: row.name, openCount: row.open_count }));
}

/** Open-task counts for the sidebar. */
export async function navCounts(ctx: ServiceContext): Promise<{ inbox: number; today: number }> {
	const row = await ctx.db
		.prepare(
			`SELECT
				SUM(CASE WHEN t.project_id = ? AND t.parent_id IS NULL THEN 1 ELSE 0 END) AS inbox,
				SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date <= ? THEN 1 ELSE 0 END) AS today
			 FROM tasks t
			 JOIN projects p ON p.id = t.project_id AND p.archived_at IS NULL
			 JOIN project_members m ON m.project_id = t.project_id AND m.email = ?
			 WHERE t.completed_at IS NULL`
		)
		.bind(ctx.user.inboxProjectId, ctx.today, ctx.user.email)
		.first<{ inbox: number | null; today: number | null }>();
	return { inbox: row?.inbox ?? 0, today: row?.today ?? 0 };
}
