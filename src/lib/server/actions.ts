import { error, fail, redirect, type Action, type RequestEvent } from '@sveltejs/kit';
import { deleteAttachment, uploadAttachment } from './attachments';
import { getContext, type ServiceContext } from './context';
import { invalid, ServiceError } from './errors';
import * as projects from './projects';
import * as tasks from './tasks';
import { createApiToken, revokeApiToken } from './tokens';
import { updateUserSettings } from './users';
import { labelList } from './validate';

// Every page re-exports these actions, so forms anywhere can post to `?/actionName`.

type Handler = (input: {
	form: FormData;
	ctx: ServiceContext;
	event: RequestEvent;
}) => Promise<Record<string, unknown> | void>;

function action(name: string, handler: Handler): Action {
	return async (event) => {
		const form = await event.request.formData();
		const ctx = await getContext(event);
		try {
			const result = await handler({ form, ctx, event });
			return { action: name, ok: true, ...result };
		} catch (err) {
			if (err instanceof ServiceError) return fail(err.status, { action: name, error: err.message });
			throw err;
		}
	};
}

/** The field's value, or undefined when the form does not include it. */
function field(form: FormData, key: string): string | undefined {
	const value = form.get(key);
	return typeof value === 'string' ? value : undefined;
}

/** Like field(), but an empty value means "clear" (null). */
function nullable(form: FormData, key: string): string | null | undefined {
	const value = field(form, key);
	if (value === undefined) return undefined;
	return value.trim() === '' ? null : value.trim();
}

function required(form: FormData, key: string): string {
	const value = field(form, key)?.trim();
	if (!value) throw invalid(`Missing ${key}`);
	return value;
}

function bucket(event: RequestEvent): R2Bucket {
	const r2 = event.platform?.env?.TIFF_ATTACHMENTS;
	if (!r2) throw error(500, 'The TIFF_ATTACHMENTS R2 binding is not configured');
	return r2;
}

export const sharedActions = {
	quickAdd: action('quickAdd', async ({ form, ctx }) => {
		const task = await tasks.quickAddTask(ctx, field(form, 'text'), {
			projectId: nullable(form, 'projectId'),
			sectionId: nullable(form, 'sectionId'),
			parentId: nullable(form, 'parentId'),
			dueDate: nullable(form, 'dueDate')
		});
		return { taskId: task.id };
	}),

	updateTask: action('updateTask', async ({ form, ctx }) => {
		const labels = field(form, 'labels');
		await tasks.updateTask(ctx, required(form, 'taskId'), {
			title: field(form, 'title'),
			notes: field(form, 'notes'),
			priority: field(form, 'priority'),
			dueDate: nullable(form, 'dueDate'),
			dueTime: nullable(form, 'dueTime'),
			recurrence: nullable(form, 'recurrence'),
			labels: labels === undefined ? undefined : labelList(labels),
			assigneeEmail: nullable(form, 'assigneeEmail')
		});
	}),

	completeTask: action('completeTask', async ({ form, ctx }) => {
		const result = await tasks.completeTask(ctx, required(form, 'taskId'));
		return { recurred: result.recurred, nextDueDate: result.task.dueDate };
	}),

	reopenTask: action('reopenTask', async ({ form, ctx }) => {
		await tasks.reopenTask(ctx, required(form, 'taskId'));
	}),

	deleteTask: action('deleteTask', async ({ form, ctx }) => {
		await tasks.deleteTask(ctx, required(form, 'taskId'));
	}),

	moveTask: action('moveTask', async ({ form, ctx }) => {
		// `target` is "projectId" or "projectId:sectionId".
		const [projectId, sectionId] = required(form, 'target').split(':');
		await tasks.moveTask(ctx, required(form, 'taskId'), {
			projectId,
			sectionId: sectionId || null,
			parentId: form.has('parentId') ? nullable(form, 'parentId') : undefined
		});
	}),

	reorderTasks: action('reorderTasks', async ({ form, ctx }) => {
		const ids = form.getAll('ids').filter((id): id is string => typeof id === 'string' && id.length > 0);
		await tasks.reorderTasks(ctx, required(form, 'projectId'), nullable(form, 'sectionId') ?? null, ids);
	}),

	addComment: action('addComment', async ({ form, ctx }) => {
		await tasks.addComment(ctx, required(form, 'taskId'), field(form, 'body'));
	}),

	deleteComment: action('deleteComment', async ({ form, ctx }) => {
		await tasks.deleteComment(ctx, required(form, 'commentId'));
	}),

	createProject: action('createProject', async ({ form, ctx }) => {
		const project = await projects.createProject(ctx, { name: field(form, 'name'), color: field(form, 'color') });
		redirect(303, `/projects/${project.id}`);
	}),

	updateProject: action('updateProject', async ({ form, ctx }) => {
		await projects.updateProject(ctx, required(form, 'projectId'), {
			name: field(form, 'name'),
			color: field(form, 'color'),
			notes: field(form, 'notes')
		});
	}),

	archiveProject: action('archiveProject', async ({ form, ctx }) => {
		await projects.setProjectArchived(ctx, required(form, 'projectId'), true);
	}),

	unarchiveProject: action('unarchiveProject', async ({ form, ctx }) => {
		await projects.setProjectArchived(ctx, required(form, 'projectId'), false);
	}),

	deleteProject: action('deleteProject', async ({ form, ctx, event }) => {
		const keys = await projects.deleteProject(ctx, required(form, 'projectId'));
		if (keys.length) await bucket(event).delete(keys);
		redirect(303, '/projects');
	}),

	createSection: action('createSection', async ({ form, ctx }) => {
		await projects.createSection(ctx, required(form, 'projectId'), field(form, 'name'));
	}),

	renameSection: action('renameSection', async ({ form, ctx }) => {
		await projects.renameSection(ctx, required(form, 'sectionId'), field(form, 'name'));
	}),

	deleteSection: action('deleteSection', async ({ form, ctx }) => {
		await projects.deleteSection(ctx, required(form, 'sectionId'));
	}),

	addMember: action('addMember', async ({ form, ctx }) => {
		await projects.addMember(ctx, required(form, 'projectId'), field(form, 'email'));
	}),

	removeMember: action('removeMember', async ({ form, ctx }) => {
		const email = required(form, 'email').toLowerCase();
		await projects.removeMember(ctx, required(form, 'projectId'), email);
		if (email === ctx.user.email) redirect(303, '/projects');
	}),

	uploadAttachment: action('uploadAttachment', async ({ form, ctx, event }) => {
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) throw invalid('Choose a file to upload');
		await uploadAttachment(ctx, bucket(event), required(form, 'projectId'), file);
	}),

	deleteAttachment: action('deleteAttachment', async ({ form, ctx, event }) => {
		await deleteAttachment(ctx, bucket(event), required(form, 'attachmentId'));
	}),

	saveSettings: action('saveSettings', async ({ form, ctx }) => {
		await updateUserSettings(ctx.db, ctx.user.email, {
			theme: field(form, 'theme'),
			timezone: field(form, 'timezone')
		});
	}),

	createToken: action('createToken', async ({ form, ctx }) => {
		const { token } = await createApiToken(ctx.db, ctx.user.email, field(form, 'name'));
		return { token };
	}),

	revokeToken: action('revokeToken', async ({ form, ctx }) => {
		await revokeApiToken(ctx.db, ctx.user.email, required(form, 'tokenId'));
	})
};
