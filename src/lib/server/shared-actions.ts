import { fail } from '@sveltejs/kit';
import type { Actions } from '@sveltejs/kit';
import {
	getTodos,
	createTodo,
	deleteTodo,
	logPomodoro,
	updateTodo,
	getSettings,
	saveSettings,
	archiveTodo,
	unarchiveTodo,
	addTaskLog,
	deleteTaskLog,
	getProjects,
	saveProjects,
	getFocus,
	saveFocus,
	endActiveSession,
	startSession,
	saveTodos,
	updateProject,
	addProjectResource,
	deleteProjectResource,
	addProjectAttachment,
	deleteProjectAttachment,
	getGitHubInfo,
	saveGitHubInfo,
	deleteGitHubInfo,
	archiveProject,
	unarchiveProject
} from '$lib/kv';
import type { FocusState, UserSettings, Theme } from '$lib/types';
import { THEMES } from '$lib/types';
import { parseGitHubRepo, fetchRepoInfo, fetchReadme, GitHubError } from '$lib/github';

function resolveDeadline(value: string | undefined, timezoneOffset: number): number | undefined {
	if (!value) return undefined;

	const now = new Date();
	const userNow = new Date(now.getTime() - timezoneOffset * 60_000);

	if (value === 'today' || value === 'tomorrow') {
		const d = new Date(userNow);
		if (value === 'tomorrow') d.setUTCDate(d.getUTCDate() + 1);
		d.setUTCHours(23, 59, 59, 999);
		return d.getTime() + timezoneOffset * 60_000;
	}

	const parsed = new Date(value);
	if (isNaN(parsed.getTime())) return undefined;
	return parsed.getTime() + timezoneOffset * 60_000;
}

const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

function sanitizeFilename(filename: string): string {
	const sanitized = filename
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	return sanitized || 'attachment';
}

function buildAttachmentUrl(projectId: string, attachmentId: string): string {
	return `/attachments/${projectId}/${attachmentId}`;
}

export const sharedActions: Actions = {
	create: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const title = data.get('title')?.toString().trim();
		if (!title) return fail(400, { error: 'Title is required' });

		const detail = data.get('detail')?.toString().trim() || undefined;
		const tzOffset = Number(data.get('timezoneOffset') || 0);
		const deadline = resolveDeadline(data.get('deadline')?.toString().trim(), tzOffset);
		const projectIdRaw = data.get('projectId')?.toString().trim();
		let projectId: string | undefined;

		if (projectIdRaw) {
			const projects = await getProjects(kv, locals.userEmail);
			if (!projects.some((p) => p.id === projectIdRaw)) {
				return fail(400, { error: 'Project not found' });
			}
			projectId = projectIdRaw;
		}

		await createTodo(kv, locals.userEmail, title, { detail, deadline, projectId });
	},

	toggle: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);

		const todos = await getTodos(kv, locals.userEmail);
		const todo = todos.find((t) => t.id === id);
		if (!todo) return;

		todo.done = !todo.done;
		await saveTodos(kv, locals.userEmail, todos);

		if (todo.done) {
			const focus = await getFocus(kv, locals.userEmail);
			if (focus?.activeTaskId === id) {
				await endActiveSession(kv, locals.userEmail, 'done');
				await saveFocus(kv, locals.userEmail, null);
			}
		}
	},

	delete: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);

		const focus = await getFocus(kv, locals.userEmail);
		if (focus?.activeTaskId === id) {
			await endActiveSession(kv, locals.userEmail, 'manual');
			await saveFocus(kv, locals.userEmail, null);
		}

		await deleteTodo(kv, locals.userEmail, id);
	},

	update: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);

		const titleValue = data.get('title');
		const title = typeof titleValue === 'string' ? titleValue.trim() : undefined;
		if (typeof titleValue === 'string' && !title) {
			return fail(400, { error: 'Title is required' });
		}

		const detail = data.get('detail')?.toString().trim() ?? undefined;
		const tzOffset = Number(data.get('timezoneOffset') || 0);
		const deadlineRaw = data.get('deadline')?.toString().trim();
		const deadline = deadlineRaw ? resolveDeadline(deadlineRaw, tzOffset) : null;
		await updateTodo(kv, locals.userEmail, id, {
			...(title !== undefined && { title }),
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

	syncFocus: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const raw = data.get('focus')?.toString();
		if (!raw || raw === 'null') {
			await saveFocus(kv, locals.userEmail, null);
		} else {
			const parsed = JSON.parse(raw) as FocusState;
			await saveFocus(kv, locals.userEmail, parsed);
		}
	},

	focusTask: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);

		await endActiveSession(kv, locals.userEmail, 'switch');
		await startSession(kv, locals.userEmail, taskId);
		await saveFocus(kv, locals.userEmail, {
			activeTaskId: taskId,
			focusedAt: Date.now()
		});
	},

	unfocus: async ({ locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		await endActiveSession(kv, locals.userEmail, 'manual');
		await saveFocus(kv, locals.userEmail, null);
	},

	archive: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await archiveTodo(kv, locals.userEmail, id);
	},

	unarchive: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await unarchiveTodo(kv, locals.userEmail, id);
	},

	archiveProject: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await archiveProject(kv, locals.userEmail, id);
	},

	unarchiveProject: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await unarchiveProject(kv, locals.userEmail, id);
	},

	saveSettings: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const existing = await getSettings(kv, locals.userEmail);
		const clamp = (v: number) => Math.max(1, Math.min(120, v));
		const workMin = clamp(Number(data.get('work') || 25));
		const shortBreakMin = clamp(Number(data.get('shortBreak') || 5));
		const longBreakMin = clamp(Number(data.get('longBreak') || 15));
		const settings: UserSettings = {
			...existing,
			workMs: workMin * 60 * 1000,
			shortBreakMs: shortBreakMin * 60 * 1000,
			longBreakMs: longBreakMin * 60 * 1000
		};
		await saveSettings(kv, locals.userEmail, settings);
	},

	saveTheme: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const theme = data.get('theme')?.toString() as Theme;
		if (!theme || !THEMES.includes(theme)) return fail(400);
		const existing = await getSettings(kv, locals.userEmail);
		await saveSettings(kv, locals.userEmail, { ...existing, theme });
	},

	addLog: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		const text = data.get('text')?.toString().trim();
		if (!id || !text) return fail(400);
		await addTaskLog(kv, locals.userEmail, id, text);
	},

	deleteLog: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		const logId = data.get('logId')?.toString();
		if (!id || !logId) return fail(400);
		await deleteTaskLog(kv, locals.userEmail, id, logId);
	},

	createProject: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const name = data.get('name')?.toString().trim();
		if (!name) return fail(400);

		const detail = data.get('detail')?.toString().trim() || undefined;
		const repoRaw = data.get('repo')?.toString().trim();
		let githubRepo: string | undefined;

		if (repoRaw) {
			const parsed = parseGitHubRepo(repoRaw);
			if (!parsed) return fail(400, { error: 'Invalid GitHub repo format' });
			githubRepo = `${parsed.owner}/${parsed.repo}`;
		}

		const projectId = crypto.randomUUID();
		let readmeDetail: string | undefined;

		if (githubRepo && platform?.env.GITHUB_TOKEN) {
			const parsed = parseGitHubRepo(githubRepo)!;
			try {
				const [info, readmeResult] = await Promise.all([
					fetchRepoInfo(parsed.owner, parsed.repo, {
						token: platform.env.GITHUB_TOKEN
					}),
					fetchReadme(parsed.owner, parsed.repo, {
						token: platform.env.GITHUB_TOKEN
					})
				]);
				if (readmeResult) {
					info.readmeContent = readmeResult.content;
					info.readmeFetchedAt = Date.now();
					if (readmeResult.updatedAt) info.readmeUpdatedAt = readmeResult.updatedAt;
					if (!detail) readmeDetail = readmeResult.content;
				}
				await saveGitHubInfo(kv, locals.userEmail, projectId, info);
			} catch {
				// Non-fatal: cache will be populated on next page load
			}
		}

		const projects = await getProjects(kv, locals.userEmail);
		projects.push({
			id: projectId,
			name,
			createdAt: Date.now(),
			...(detail || readmeDetail ? { detail: detail ?? readmeDetail } : {}),
			...(githubRepo ? { githubRepo } : {})
		});
		await saveProjects(kv, locals.userEmail, projects);
	},

	updateProject: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);

		const name = data.get('name')?.toString().trim();
		const detailValue = data.get('detail');
		const patch: { name?: string; detail?: string | null } = {};

		if (name) patch.name = name;
		if (typeof detailValue === 'string') {
			patch.detail = detailValue.trim() || null;
		}

		if (Object.keys(patch).length === 0) return;
		await updateProject(kv, locals.userEmail, id, patch);
	},

	deleteProject: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const r2 = platform!.env.TIFF_ATTACHMENTS;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);

		const projects = await getProjects(kv, locals.userEmail);
		const deletedProject = projects.find((p) => p.id === id);
		const keys = (deletedProject?.attachments ?? []).map((a) => a.key).filter((k): k is string => Boolean(k));
		if (keys.length > 0) await r2.delete(keys);
		await saveProjects(kv, locals.userEmail, projects.filter((p) => p.id !== id));
		await deleteGitHubInfo(kv, locals.userEmail, id);

		const todos = await getTodos(kv, locals.userEmail);
		let changed = false;
		for (const todo of todos) {
			if (todo.projectId === id) {
				delete todo.projectId;
				changed = true;
			}
		}
		if (changed) await saveTodos(kv, locals.userEmail, todos);
	},

	setTaskProject: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const todoId = data.get('todoId')?.toString();
		const projectId = data.get('projectId')?.toString().trim() || undefined;
		if (!todoId) return fail(400);

		if (projectId) {
			const projects = await getProjects(kv, locals.userEmail);
			if (!projects.some((p) => p.id === projectId)) {
				return fail(400, { error: 'Project not found' });
			}
		}

		const todos = await getTodos(kv, locals.userEmail);
		const todo = todos.find((t) => t.id === todoId);
		if (!todo) return;

		if (projectId) {
			todo.projectId = projectId;
		} else {
			delete todo.projectId;
		}
		await saveTodos(kv, locals.userEmail, todos);
	},

	linkGithub: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const token = platform?.env.GITHUB_TOKEN;
		if (!token) return fail(400, { error: 'GitHub integration not configured' });

		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const repo = data.get('repo')?.toString().trim();
		if (!projectId || !repo) return fail(400);

		const parsed = parseGitHubRepo(repo);
		if (!parsed) return fail(400, { error: 'Invalid repo format. Use owner/repo or a GitHub URL.' });

		const projects = await getProjects(kv, locals.userEmail);
		const project = projects.find((p) => p.id === projectId);
		if (!project) return fail(400, { error: 'Project not found' });

		try {
			const [info, readmeResult] = await Promise.all([
				fetchRepoInfo(parsed.owner, parsed.repo, { token }),
				fetchReadme(parsed.owner, parsed.repo, { token })
			]);
			project.githubRepo = `${parsed.owner}/${parsed.repo}`;

			if (readmeResult) {
				info.readmeContent = readmeResult.content;
				info.readmeFetchedAt = Date.now();
				if (readmeResult.updatedAt) info.readmeUpdatedAt = readmeResult.updatedAt;
				if (!project.detail) project.detail = readmeResult.content;
			}

			await saveProjects(kv, locals.userEmail, projects);
			await saveGitHubInfo(kv, locals.userEmail, projectId, info);
		} catch (e) {
			if (e instanceof GitHubError) {
				if (e.code === 'not_found') return fail(400, { error: 'Repository not found' });
				if (e.code === 'rate_limited') return fail(429, { error: 'GitHub rate limit exceeded' });
			}
			return fail(500, { error: 'Failed to fetch repository info' });
		}
	},

	syncReadme: async ({ request, locals, platform }) => {
		const token = platform?.env.GITHUB_TOKEN;
		if (!token) return fail(400, { error: 'GitHub integration not configured' });

		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		if (!projectId) return fail(400);

		const projects = await getProjects(kv, locals.userEmail);
		const project = projects.find((p) => p.id === projectId);
		if (!project?.githubRepo) return fail(400, { error: 'No GitHub repo linked' });

		const parsed = parseGitHubRepo(project.githubRepo);
		if (!parsed) return fail(400, { error: 'Invalid repo format' });

		const readmeResult = await fetchReadme(parsed.owner, parsed.repo, { token });
		if (!readmeResult) return fail(404, { error: 'README not found in repository' });

		// Write README to project detail
		project.detail = readmeResult.content;
		await saveProjects(kv, locals.userEmail, projects);

		// Update cached GitHub info with README content
		const existing = await getGitHubInfo(kv, locals.userEmail, projectId);
		if (existing) {
			existing.readmeContent = readmeResult.content;
			existing.readmeFetchedAt = Date.now();
			if (readmeResult.updatedAt) existing.readmeUpdatedAt = readmeResult.updatedAt;
			await saveGitHubInfo(kv, locals.userEmail, projectId, existing);
		}
	},

	unlinkGithub: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		if (!projectId) return fail(400);

		const projects = await getProjects(kv, locals.userEmail);
		const project = projects.find((p) => p.id === projectId);
		if (!project) return fail(400);

		delete project.githubRepo;
		await saveProjects(kv, locals.userEmail, projects);
		await deleteGitHubInfo(kv, locals.userEmail, projectId);
	},

	syncGithub: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const token = platform?.env.GITHUB_TOKEN;
		if (!token) return fail(400, { error: 'GitHub integration not configured' });

		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		if (!projectId) return fail(400);

		const projects = await getProjects(kv, locals.userEmail);
		const project = projects.find((p) => p.id === projectId);
		if (!project?.githubRepo) return fail(400, { error: 'No GitHub repo linked' });

		const parsed = parseGitHubRepo(project.githubRepo);
		if (!parsed) return fail(400, { error: 'Invalid repo format' });

		try {
			const [info, readmeResult] = await Promise.all([
				fetchRepoInfo(parsed.owner, parsed.repo, { token }),
				fetchReadme(parsed.owner, parsed.repo, { token })
			]);
			if (readmeResult) {
				info.readmeContent = readmeResult.content;
				info.readmeFetchedAt = Date.now();
				if (readmeResult.updatedAt) info.readmeUpdatedAt = readmeResult.updatedAt;
			}
			await saveGitHubInfo(kv, locals.userEmail, projectId, info);
		} catch (e) {
			if (e instanceof GitHubError) {
				if (e.code === 'rate_limited') return fail(429, { error: 'GitHub rate limit exceeded' });
			}
			return fail(500, { error: 'Failed to sync repository info' });
		}
	},

	addProjectResource: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const url = data.get('url')?.toString().trim();
		if (!projectId || !url) return fail(400);
		const label = data.get('label')?.toString().trim() || undefined;
		await addProjectResource(kv, locals.userEmail, projectId, url, label);
	},

	deleteProjectResource: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const resourceId = data.get('resourceId')?.toString();
		if (!projectId || !resourceId) return fail(400);
		await deleteProjectResource(kv, locals.userEmail, projectId, resourceId);
	},

	addProjectAttachment: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const r2 = platform!.env.TIFF_ATTACHMENTS;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const file = data.get('file');
		if (!projectId || !(file instanceof File)) return fail(400);
		if (!file.size) return fail(400, { error: 'Attachment file is required' });
		if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
			return fail(400, { error: 'Attachment is too large (max 25MB)' });
		}

		const fileName = file.name?.trim() || 'attachment';
		const attachmentId = crypto.randomUUID();
		const safeName = sanitizeFilename(fileName);
		const objectKey = `${locals.userEmail}/${projectId}/${attachmentId}-${safeName}`;
		const contentType = file.type || 'application/octet-stream';
		const payload = await file.arrayBuffer();

		await r2.put(objectKey, payload, {
			httpMetadata: {
				contentType,
				contentDisposition: `inline; filename=\"${safeName}\"`
			}
		});

		const providedName = data.get('name')?.toString().trim();
		const name = providedName || fileName;
		const stored = await addProjectAttachment(kv, locals.userEmail, projectId, {
			id: attachmentId,
			name,
			url: buildAttachmentUrl(projectId, attachmentId),
			key: objectKey,
			contentType,
			size: file.size
		});

		if (!stored) {
			await r2.delete(objectKey);
			return fail(400, { error: 'Project not found' });
		}
	},

	deleteProjectAttachment: async ({ request, locals, platform }) => {
		const kv = platform!.env.TIFF_KV;
		const r2 = platform!.env.TIFF_ATTACHMENTS;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const attachmentId = data.get('attachmentId')?.toString();
		if (!projectId || !attachmentId) return fail(400);
		const attachment = await deleteProjectAttachment(kv, locals.userEmail, projectId, attachmentId);
		if (attachment?.key) await r2.delete(attachment.key);
	}
};
