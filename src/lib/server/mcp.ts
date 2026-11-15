import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { addDays } from '$lib/dates';
import { parseDueString } from '$lib/quickadd';
import { PROJECT_COLOR_NAMES, type Comment, type Task } from '$lib/types';
import type { ServiceContext } from './context';
import { invalid, ServiceError } from './errors';
import * as projects from './projects';
import * as tasks from './tasks';

const INSTRUCTIONS = `TIFF is a shared task manager (similar to Todoist).
Tasks live in projects; every user has an "Inbox" project. Projects can have sections and can be shared with other people by email.
Tasks have a priority from 1 (highest, urgent) to 4 (default, none), an optional due date (YYYY-MM-DD, in the user's time zone) and time (HH:MM),
an optional recurrence such as "every monday", labels, subtasks (one level deep) and comments.
Completing a recurring task moves it to its next due date instead of closing it.
Use quick_add_task when the user speaks naturally ("call mom tomorrow 6pm p1 #Family @phone"); use create_task for precise structured input.
Look up project and section ids with list_projects / get_project before creating or moving tasks into them.`;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function json(data: unknown): ToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function run<A>(fn: (args: A) => Promise<unknown>) {
	return async (args: A): Promise<ToolResult> => {
		try {
			return json(await fn(args));
		} catch (err) {
			if (err instanceof ServiceError) {
				return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
			}
			throw err;
		}
	};
}

function iso(timestamp: number | null): string | null {
	return timestamp === null ? null : new Date(timestamp).toISOString();
}

const id = z.string().min(1).max(64);
const optionalId = id.optional();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM (24-hour)');
const priority = z
	.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
	.describe('1 = urgent/highest, 4 = none (default)');
const labelArray = z.array(z.string().max(60)).max(20);
const dueString = z
	.string()
	.max(200)
	.describe('Natural language due date, e.g. "tomorrow 5pm", "next fri", "every weekday 9am", "jan 5"');

export function createMcpServer(ctx: ServiceContext, origin: string): McpServer {
	const server = new McpServer({ name: 'tiff', version: '1.0.0' }, { instructions: INSTRUCTIONS });

	const taskUrl = (task: Task) =>
		task.projectId === ctx.user.inboxProjectId
			? `${origin}/inbox?task=${task.id}`
			: `${origin}/projects/${task.projectId}?task=${task.id}`;

	const serializeTask = (task: Task) => ({
		id: task.id,
		title: task.title,
		notes: task.notes,
		project: { id: task.projectId, name: task.projectName },
		section_id: task.sectionId,
		parent_id: task.parentId,
		priority: task.priority,
		due_date: task.dueDate,
		due_time: task.dueTime,
		recurrence: task.recurrence,
		labels: task.labels,
		assignee_email: task.assigneeEmail,
		completed_at: iso(task.completedAt),
		subtasks: task.subtaskCount ? { total: task.subtaskCount, done: task.subtaskDoneCount } : undefined,
		comment_count: task.commentCount || undefined,
		url: taskUrl(task)
	});

	const serializeComment = (comment: Comment) => ({
		id: comment.id,
		author: comment.authorEmail,
		body: comment.body,
		created_at: iso(comment.createdAt)
	});

	function resolveDue(args: { due_string?: string; due_date?: string | null; due_time?: string | null; recurrence?: string | null }) {
		if (args.due_string !== undefined) {
			if (args.due_string.trim() === '') return { dueDate: null, dueTime: null, recurrence: null };
			const parsed = parseDueString(args.due_string, ctx.today);
			if (!parsed) throw invalid(`Could not understand due "${args.due_string}". Use due_date/due_time instead.`);
			return parsed;
		}
		return { dueDate: args.due_date, dueTime: args.due_time, recurrence: args.recurrence };
	}

	server.registerTool(
		'get_context',
		{
			title: 'Get context',
			description: "Returns the signed-in user's email, time zone, today's date and Inbox project id.",
			annotations: { readOnlyHint: true }
		},
		run(async () => ({
			email: ctx.user.email,
			timezone: ctx.user.timezone,
			today: ctx.today,
			inbox_project_id: ctx.user.inboxProjectId
		}))
	);

	server.registerTool(
		'list_projects',
		{
			title: 'List projects',
			description: 'Lists projects the user can access, with open task counts and sharing info.',
			inputSchema: z.object({ archived: z.boolean().optional().describe('List archived projects instead') }),
			annotations: { readOnlyHint: true }
		},
		run(async ({ archived }: { archived?: boolean }) =>
			(await projects.listProjects(ctx, { archived })).map((p) => ({
				id: p.id,
				name: p.name,
				color: p.color,
				is_inbox: p.isInbox,
				role: p.role,
				owner: p.ownerEmail,
				members: p.memberCount,
				open_tasks: p.openCount
			}))
		)
	);

	server.registerTool(
		'get_project',
		{
			title: 'Get project',
			description: 'Returns a project with its notes, sections and members.',
			inputSchema: z.object({ project_id: id }),
			annotations: { readOnlyHint: true }
		},
		run(async ({ project_id }: { project_id: string }) => {
			const p = await projects.getProject(ctx, project_id);
			return {
				id: p.id,
				name: p.name,
				color: p.color,
				is_inbox: p.isInbox,
				notes: p.notes,
				role: p.role,
				archived: Boolean(p.archivedAt),
				sections: p.sections.map((s) => ({ id: s.id, name: s.name })),
				members: p.members.map((m) => ({ email: m.email, role: m.role })),
				attachments: p.attachments.map((a) => ({ id: a.id, name: a.name, size: a.size }))
			};
		})
	);

	server.registerTool(
		'create_project',
		{
			title: 'Create project',
			description: 'Creates a new project owned by the user.',
			inputSchema: z.object({
				name: z.string().min(1).max(120),
				color: z.enum(PROJECT_COLOR_NAMES as [string, ...string[]]).optional()
			})
		},
		run(async ({ name, color }: { name: string; color?: string }) => {
			const p = await projects.createProject(ctx, { name, color });
			return { id: p.id, name: p.name, color: p.color };
		})
	);

	server.registerTool(
		'update_project',
		{
			title: 'Update project',
			description: 'Renames, recolors, edits notes, or archives/unarchives a project. Archiving requires ownership.',
			inputSchema: z.object({
				project_id: id,
				name: z.string().min(1).max(120).optional(),
				color: z.enum(PROJECT_COLOR_NAMES as [string, ...string[]]).optional(),
				notes: z.string().max(20000).optional(),
				archived: z.boolean().optional()
			})
		},
		run(
			async (args: { project_id: string; name?: string; color?: string; notes?: string; archived?: boolean }) => {
				if (args.archived === false) await projects.setProjectArchived(ctx, args.project_id, false);
				if (args.name !== undefined || args.color !== undefined || args.notes !== undefined) {
					await projects.updateProject(ctx, args.project_id, { name: args.name, color: args.color, notes: args.notes });
				}
				if (args.archived === true) await projects.setProjectArchived(ctx, args.project_id, true);
				return { ok: true };
			}
		)
	);

	server.registerTool(
		'create_section',
		{
			title: 'Create section',
			description: 'Adds a section to a project.',
			inputSchema: z.object({ project_id: id, name: z.string().min(1).max(120) })
		},
		run(async ({ project_id, name }: { project_id: string; name: string }) => {
			const section = await projects.createSection(ctx, project_id, name);
			return { id: section.id, name: section.name };
		})
	);

	server.registerTool(
		'share_project',
		{
			title: 'Share project',
			description:
				'Adds or removes a project member by email. Only the owner can add or remove others; any member can remove themselves to leave.',
			inputSchema: z.object({
				project_id: id,
				email: z.string().min(3).max(254),
				action: z.enum(['add', 'remove']).default('add')
			}),
			annotations: { destructiveHint: true }
		},
		run(async ({ project_id, email, action }: { project_id: string; email: string; action: 'add' | 'remove' }) => {
			if (action === 'add') await projects.addMember(ctx, project_id, email);
			else await projects.removeMember(ctx, project_id, email);
			if (email.trim().toLowerCase() === ctx.user.email) return { left: true };
			const project = await projects.getProject(ctx, project_id);
			return { members: project.members.map((m) => ({ email: m.email, role: m.role })) };
		})
	);

	server.registerTool(
		'list_tasks',
		{
			title: 'List tasks',
			description: `Lists tasks. Views: "today" (due today or overdue), "upcoming" (due in the next N days), "inbox", "completed" (recently completed), or "all" (open tasks). Combine with filters to narrow results.`,
			inputSchema: z.object({
				view: z.enum(['all', 'today', 'upcoming', 'inbox', 'completed']).default('all'),
				project_id: optionalId,
				section_id: optionalId,
				parent_id: optionalId.describe('Only subtasks of this task'),
				label: z.string().max(60).optional(),
				query: z.string().max(200).optional().describe('Text to search in titles and notes'),
				due_before: dateString.optional().describe('Due on or before this date'),
				due_after: dateString.optional().describe('Due on or after this date'),
				assignee_email: z.string().optional(),
				upcoming_days: z.number().int().min(1).max(90).default(7),
				limit: z.number().int().min(1).max(500).default(100)
			}),
			annotations: { readOnlyHint: true }
		},
		run(
			async (args: {
				view: 'all' | 'today' | 'upcoming' | 'inbox' | 'completed';
				project_id?: string;
				section_id?: string;
				parent_id?: string;
				label?: string;
				query?: string;
				due_before?: string;
				due_after?: string;
				assignee_email?: string;
				upcoming_days: number;
				limit: number;
			}) => {
				const filter: tasks.TaskFilter = {
					projectId: args.project_id,
					sectionId: args.section_id,
					parentId: args.parent_id,
					label: args.label,
					search: args.query,
					dueOnOrBefore: args.due_before,
					dueOnOrAfter: args.due_after,
					assigneeEmail: args.assignee_email,
					limit: args.limit
				};
				if (args.view === 'today') {
					filter.dueOnOrBefore = ctx.today;
					filter.order = 'due';
				} else if (args.view === 'upcoming') {
					filter.dueOnOrAfter = ctx.today;
					filter.dueOnOrBefore = addDays(ctx.today, args.upcoming_days - 1);
					filter.order = 'due';
				} else if (args.view === 'inbox') {
					filter.projectId = ctx.user.inboxProjectId;
				} else if (args.view === 'completed') {
					filter.status = 'completed';
					filter.order = 'completed';
				}
				const result = await tasks.listTasks(ctx, filter);
				return { today: ctx.today, count: result.length, tasks: result.map(serializeTask) };
			}
		)
	);

	server.registerTool(
		'get_task',
		{
			title: 'Get task',
			description: 'Returns a task with its subtasks and comments.',
			inputSchema: z.object({ task_id: id }),
			annotations: { readOnlyHint: true }
		},
		run(async ({ task_id }: { task_id: string }) => {
			const detail = await tasks.getTaskDetail(ctx, task_id);
			return {
				...serializeTask(detail.task),
				section: detail.sections.find((s) => s.id === detail.task.sectionId)?.name ?? null,
				subtasks: detail.subtasks.map(serializeTask),
				comments: detail.comments.map(serializeComment)
			};
		})
	);

	server.registerTool(
		'quick_add_task',
		{
			title: 'Quick add task',
			description:
				'Creates a task from natural language, Todoist style. Supports #Project, @label, p1-p4, dates ("tomorrow", "next fri", "jan 5", "in 3 days"), times ("5pm", "17:30") and recurrence ("every weekday", "every 2 weeks"). Unknown #projects stay in the title.',
			inputSchema: z.object({
				text: z.string().min(1).max(1000),
				project_id: optionalId.describe('Default project when the text has no #Project'),
				parent_id: optionalId.describe('Create as a subtask of this task')
			})
		},
		run(async ({ text, project_id, parent_id }: { text: string; project_id?: string; parent_id?: string }) =>
			serializeTask(await tasks.quickAddTask(ctx, text, { projectId: project_id, parentId: parent_id }))
		)
	);

	server.registerTool(
		'create_task',
		{
			title: 'Create task',
			description:
				'Creates a task from structured fields. Defaults to the Inbox. Give either due_string or due_date/due_time/recurrence.',
			inputSchema: z.object({
				title: z.string().min(1).max(500),
				notes: z.string().max(20000).optional(),
				project_id: optionalId,
				section_id: optionalId,
				parent_id: optionalId.describe('Create as a subtask (inherits the parent project and section)'),
				priority: priority.optional(),
				due_string: dueString.optional(),
				due_date: dateString.optional(),
				due_time: timeString.optional(),
				recurrence: z.string().max(100).optional().describe('e.g. "every day", "every mon, fri", "every 3 months"'),
				labels: labelArray.optional(),
				assignee_email: z.string().optional().describe('Must be a member of the project')
			})
		},
		run(
			async (args: {
				title: string;
				notes?: string;
				project_id?: string;
				section_id?: string;
				parent_id?: string;
				priority?: number;
				due_string?: string;
				due_date?: string;
				due_time?: string;
				recurrence?: string;
				labels?: string[];
				assignee_email?: string;
			}) => {
				const due = resolveDue(args);
				const task = await tasks.createTask(ctx, {
					title: args.title,
					notes: args.notes,
					projectId: args.project_id,
					sectionId: args.section_id,
					parentId: args.parent_id,
					priority: args.priority,
					dueDate: due.dueDate ?? null,
					dueTime: due.dueTime ?? null,
					recurrence: due.recurrence ?? null,
					labels: args.labels,
					assigneeEmail: args.assignee_email
				});
				return serializeTask(task);
			}
		)
	);

	server.registerTool(
		'update_task',
		{
			title: 'Update task',
			description:
				'Updates task fields. Omitted fields are unchanged. Pass null to clear notes, due_date, due_time, recurrence or assignee_email. An empty due_string clears the due date. labels replaces the full label list.',
			inputSchema: z.object({
				task_id: id,
				title: z.string().min(1).max(500).optional(),
				notes: z.string().max(20000).nullable().optional(),
				priority: priority.optional(),
				due_string: dueString.optional(),
				due_date: dateString.nullable().optional(),
				due_time: timeString.nullable().optional(),
				recurrence: z.string().max(100).nullable().optional(),
				labels: labelArray.optional(),
				assignee_email: z.string().nullable().optional()
			}),
			annotations: { idempotentHint: true }
		},
		run(
			async (args: {
				task_id: string;
				title?: string;
				notes?: string | null;
				priority?: number;
				due_string?: string;
				due_date?: string | null;
				due_time?: string | null;
				recurrence?: string | null;
				labels?: string[];
				assignee_email?: string | null;
			}) => {
				const due = resolveDue(args);
				const task = await tasks.updateTask(ctx, args.task_id, {
					title: args.title,
					notes: args.notes,
					priority: args.priority,
					dueDate: due.dueDate,
					dueTime: due.dueTime,
					recurrence: due.recurrence,
					labels: args.labels,
					assigneeEmail: args.assignee_email
				});
				return serializeTask(task);
			}
		)
	);

	server.registerTool(
		'complete_task',
		{
			title: 'Complete task',
			description:
				'Marks a task done (and its open subtasks). A recurring task instead moves to its next due date and stays open.',
			inputSchema: z.object({ task_id: id })
		},
		run(async ({ task_id }: { task_id: string }) => {
			const result = await tasks.completeTask(ctx, task_id);
			return { recurred: result.recurred, task: serializeTask(result.task) };
		})
	);

	server.registerTool(
		'reopen_task',
		{
			title: 'Reopen task',
			description: 'Marks a completed task as not done.',
			inputSchema: z.object({ task_id: id }),
			annotations: { idempotentHint: true }
		},
		run(async ({ task_id }: { task_id: string }) => serializeTask(await tasks.reopenTask(ctx, task_id)))
	);

	server.registerTool(
		'move_task',
		{
			title: 'Move task',
			description:
				'Moves a task to another project, section or parent. Pass section_id null to remove the section, parent_id null to make it top-level. Subtasks move with their parent.',
			inputSchema: z.object({
				task_id: id,
				project_id: optionalId,
				section_id: id.nullable().optional(),
				parent_id: id.nullable().optional()
			})
		},
		run(
			async (args: { task_id: string; project_id?: string; section_id?: string | null; parent_id?: string | null }) =>
				serializeTask(
					await tasks.moveTask(ctx, args.task_id, {
						projectId: args.project_id,
						sectionId: args.section_id,
						parentId: args.parent_id
					})
				)
		)
	);

	server.registerTool(
		'delete_task',
		{
			title: 'Delete task',
			description: 'Permanently deletes a task with its subtasks and comments. Prefer complete_task unless asked to delete.',
			inputSchema: z.object({ task_id: id }),
			annotations: { destructiveHint: true }
		},
		run(async ({ task_id }: { task_id: string }) => {
			await tasks.deleteTask(ctx, task_id);
			return { deleted: task_id };
		})
	);

	server.registerTool(
		'add_comment',
		{
			title: 'Add comment',
			description: 'Adds a comment to a task. Markdown is allowed.',
			inputSchema: z.object({ task_id: id, body: z.string().min(1).max(10000) })
		},
		run(async ({ task_id, body }: { task_id: string; body: string }) =>
			serializeComment(await tasks.addComment(ctx, task_id, body))
		)
	);

	server.registerTool(
		'list_labels',
		{
			title: 'List labels',
			description: 'Lists labels in use with their open task counts.',
			annotations: { readOnlyHint: true }
		},
		run(async () => (await tasks.listLabels(ctx)).map((l) => ({ name: l.name, open_tasks: l.openCount })))
	);

	return server;
}
