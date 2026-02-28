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
	unarchiveProject,
	focusTaskTx,
	unfocusTx,
	toggleTodoAndHandleFocusTx,
	deleteProjectCascadeTx
} from '$lib/storage';
import type { FocusState, UserSettings, Theme } from '$lib/types';
import { THEMES } from '$lib/types';
import { parseGitHubRepo, fetchRepoInfo, fetchReadme, GitHubError } from '$lib/github';
import {
	backfillUser,
	collectAllUserEmails,
	ensureMigrationRun,
	getMigrationRun,
	getLatestMigrationRun,
	updateMigrationRunProgress
} from '$lib/server/migrations';

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
		const env = platform?.env;
		const data = await request.formData();
		const title = data.get('title')?.toString().trim();
		if (!title) return fail(400, { error: 'Title is required' });

		const detail = data.get('detail')?.toString().trim() || undefined;
		const tzOffset = Number(data.get('timezoneOffset') || 0);
		const deadline = resolveDeadline(data.get('deadline')?.toString().trim(), tzOffset);
		const projectIdRaw = data.get('projectId')?.toString().trim();
		let projectId: string | undefined;

		if (projectIdRaw) {
			const projects = await getProjects(env, locals.userEmail);
			if (!projects.some((p) => p.id === projectIdRaw)) {
				return fail(400, { error: 'Project not found' });
			}
			projectId = projectIdRaw;
		}

		await createTodo(env, locals.userEmail, title, { detail, deadline, projectId });
	},

	toggle: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await toggleTodoAndHandleFocusTx(env, locals.userEmail, id);
	},

	delete: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);

		const focus = await getFocus(env, locals.userEmail);
		if (focus?.activeTaskId === id) {
			await endActiveSession(env, locals.userEmail, 'manual');
			await saveFocus(env, locals.userEmail, null);
		}

		await deleteTodo(env, locals.userEmail, id);
	},

	update: async ({ request, locals, platform }) => {
		const env = platform?.env;
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
		await updateTodo(env, locals.userEmail, id, {
			...(title !== undefined && { title }),
			...(detail !== undefined && { detail }),
			...(deadline !== undefined && { deadline })
		});
	},

	logPomodoro: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		const type = data.get('type')?.toString() as 'work' | 'short-break' | 'long-break';
		const duration = Number(data.get('duration'));
		if (!taskId || !type || !duration) return fail(400);
		await logPomodoro(env, locals.userEmail, { taskId, type, duration });
	},

	syncFocus: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const raw = data.get('focus')?.toString();
		if (!raw || raw === 'null') {
			await saveFocus(env, locals.userEmail, null);
		} else {
			const parsed = JSON.parse(raw) as FocusState;
			await saveFocus(env, locals.userEmail, parsed);
		}
	},

	focusTask: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await focusTaskTx(env, locals.userEmail, taskId);
	},

	unfocus: async ({ locals, platform }) => {
		const env = platform?.env;
		await unfocusTx(env, locals.userEmail, 'manual');
	},

	archive: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await archiveTodo(env, locals.userEmail, id);
	},

	unarchive: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await unarchiveTodo(env, locals.userEmail, id);
	},

	archiveProject: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await archiveProject(env, locals.userEmail, id);
	},

	unarchiveProject: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);
		await unarchiveProject(env, locals.userEmail, id);
	},

	saveSettings: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const existing = await getSettings(env, locals.userEmail);
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
		await saveSettings(env, locals.userEmail, settings);
	},

	saveTheme: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const theme = data.get('theme')?.toString() as Theme;
		if (!theme || !THEMES.includes(theme)) return fail(400);
		const existing = await getSettings(env, locals.userEmail);
		await saveSettings(env, locals.userEmail, { ...existing, theme });
	},

	runBackfill: async ({ request, platform }) => {
		const env = platform?.env;
		if (!env?.TIFF_KV || !env.TIFF_DB) {
			return fail(500, { error: 'Both KV and D1 storage must be configured' });
		}
		if (!env.MIGRATION_ADMIN_TOKEN) {
			return fail(403, { error: 'Migration is disabled (missing MIGRATION_ADMIN_TOKEN)' });
		}

		const data = await request.formData();
		const requestedRunId = data.get('runId')?.toString().trim();
		const selectedEmail = data.get('selectedEmail')?.toString().trim() || null;
		const batchUsers = Math.max(1, Math.min(500, Number(data.get('batchUsers') || 50)));

		// Single-user mode: migrate one specific user immediately
		if (selectedEmail) {
			const runId = crypto.randomUUID();
			await ensureMigrationRun(env.TIFF_DB, runId);

			try {
				await backfillUser(env.TIFF_KV, env.TIFF_DB, selectedEmail);
				await updateMigrationRunProgress(env.TIFF_DB, runId, {
					status: 'completed',
					totalUsers: 1,
					processedUsersDelta: 1,
					notes: `Single user: ${selectedEmail}`,
					finished: true
				});
				return { runId, processedUsers: 1, totalUsers: 1, scanComplete: true };
			} catch (err) {
				await updateMigrationRunProgress(env.TIFF_DB, runId, {
					status: 'failed',
					totalUsers: 1,
					notes: `Failed: ${selectedEmail} — ${err instanceof Error ? err.message : String(err)}`,
					finished: true
				});
				return fail(500, { error: `Backfill failed for ${selectedEmail}` });
			}
		}

		// Batch mode: migrate all users with offset-based pagination
		let runId = requestedRunId;
		let offset = 0;
		if (!runId) {
			const latest = await getLatestMigrationRun(env.TIFF_DB);
			if (latest?.status === 'running') {
				runId = latest.runId;
				offset = latest.processedUsers;
			} else {
				runId = crypto.randomUUID();
			}
		} else {
			const existing = await getMigrationRun(env.TIFF_DB, runId);
			if (existing) offset = existing.processedUsers;
		}

		await ensureMigrationRun(env.TIFF_DB, runId);

		let allEmails: string[];
		try {
			allEmails = await collectAllUserEmails(env.TIFF_KV);
		} catch (err) {
			await updateMigrationRunProgress(env.TIFF_DB, runId, {
				status: 'failed',
				notes: `KV scan failed: ${err instanceof Error ? err.message : String(err)}`,
				finished: true
			});
			return fail(500, { error: 'Failed to scan KV for user emails' });
		}

		const batch = allEmails.slice(offset, offset + batchUsers);
		const scanComplete = offset + batch.length >= allEmails.length;

		const failed: Array<{ email: string; error: string }> = [];
		let processed = 0;
		for (const email of batch) {
			try {
				await backfillUser(env.TIFF_KV, env.TIFF_DB, email);
				processed += 1;
			} catch (error) {
				failed.push({
					email,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		}

		await updateMigrationRunProgress(env.TIFF_DB, runId, {
			status: failed.length > 0 ? 'failed' : scanComplete ? 'completed' : 'running',
			totalUsers: allEmails.length,
			processedUsersDelta: processed,
			notes: failed.length > 0 ? `Failed users: ${failed.map((entry) => entry.email).join(', ')}` : undefined,
			finished: scanComplete
		});

		if (failed.length > 0) {
			return fail(500, {
				error: `Backfill failed for ${failed.length} user(s)`,
				failedUsers: failed.map((entry) => entry.email)
			});
		}

		return {
			runId,
			processedUsers: processed,
			totalUsers: allEmails.length,
			scanComplete
		};
	},

	addLog: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		const text = data.get('text')?.toString().trim();
		if (!id || !text) return fail(400);
		await addTaskLog(env, locals.userEmail, id, text);
	},

	deleteLog: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		const logId = data.get('logId')?.toString();
		if (!id || !logId) return fail(400);
		await deleteTaskLog(env, locals.userEmail, id, logId);
	},

	createProject: async ({ request, locals, platform }) => {
		const env = platform?.env;
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
				await saveGitHubInfo(env, locals.userEmail, projectId, info);
			} catch {
				// Non-fatal: cache will be populated on next page load
			}
		}

		const projects = await getProjects(env, locals.userEmail);
		projects.push({
			id: projectId,
			name,
			createdAt: Date.now(),
			...(detail || readmeDetail ? { detail: detail ?? readmeDetail } : {}),
			...(githubRepo ? { githubRepo } : {})
		});
		await saveProjects(env, locals.userEmail, projects);
	},

	updateProject: async ({ request, locals, platform }) => {
		const env = platform?.env;
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
		await updateProject(env, locals.userEmail, id, patch);
	},

	deleteProject: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const r2 = platform!.env.TIFF_ATTACHMENTS;
		const data = await request.formData();
		const id = data.get('id')?.toString();
		if (!id) return fail(400);

		const { attachmentKeys: keys } = await deleteProjectCascadeTx(env, locals.userEmail, id);
		if (keys.length > 0) await r2.delete(keys);
		await deleteGitHubInfo(env, locals.userEmail, id);
	},

	setTaskProject: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const todoId = data.get('todoId')?.toString();
		const projectId = data.get('projectId')?.toString().trim() || undefined;
		if (!todoId) return fail(400);

		if (projectId) {
			const projects = await getProjects(env, locals.userEmail);
			if (!projects.some((p) => p.id === projectId)) {
				return fail(400, { error: 'Project not found' });
			}
		}

		const todos = await getTodos(env, locals.userEmail);
		const todo = todos.find((t) => t.id === todoId);
		if (!todo) return;

		if (projectId) {
			todo.projectId = projectId;
		} else {
			delete todo.projectId;
		}
		await saveTodos(env, locals.userEmail, todos);
	},

	linkGithub: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const token = platform?.env.GITHUB_TOKEN;
		if (!token) return fail(400, { error: 'GitHub integration not configured' });

		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const repo = data.get('repo')?.toString().trim();
		if (!projectId || !repo) return fail(400);

		const parsed = parseGitHubRepo(repo);
		if (!parsed) return fail(400, { error: 'Invalid repo format. Use owner/repo or a GitHub URL.' });

		const projects = await getProjects(env, locals.userEmail);
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

			await saveProjects(env, locals.userEmail, projects);
			await saveGitHubInfo(env, locals.userEmail, projectId, info);
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

		const env = platform?.env;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		if (!projectId) return fail(400);

		const projects = await getProjects(env, locals.userEmail);
		const project = projects.find((p) => p.id === projectId);
		if (!project?.githubRepo) return fail(400, { error: 'No GitHub repo linked' });

		const parsed = parseGitHubRepo(project.githubRepo);
		if (!parsed) return fail(400, { error: 'Invalid repo format' });

		const readmeResult = await fetchReadme(parsed.owner, parsed.repo, { token });
		if (!readmeResult) return fail(404, { error: 'README not found in repository' });

		// Write README to project detail
		project.detail = readmeResult.content;
		await saveProjects(env, locals.userEmail, projects);

		// Update cached GitHub info with README content
		const existing = await getGitHubInfo(env, locals.userEmail, projectId);
		if (existing) {
			existing.readmeContent = readmeResult.content;
			existing.readmeFetchedAt = Date.now();
			if (readmeResult.updatedAt) existing.readmeUpdatedAt = readmeResult.updatedAt;
			await saveGitHubInfo(env, locals.userEmail, projectId, existing);
		}
	},

	unlinkGithub: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		if (!projectId) return fail(400);

		const projects = await getProjects(env, locals.userEmail);
		const project = projects.find((p) => p.id === projectId);
		if (!project) return fail(400);

		delete project.githubRepo;
		await saveProjects(env, locals.userEmail, projects);
		await deleteGitHubInfo(env, locals.userEmail, projectId);
	},

	syncGithub: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const token = platform?.env.GITHUB_TOKEN;
		if (!token) return fail(400, { error: 'GitHub integration not configured' });

		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		if (!projectId) return fail(400);

		const projects = await getProjects(env, locals.userEmail);
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
			await saveGitHubInfo(env, locals.userEmail, projectId, info);
		} catch (e) {
			if (e instanceof GitHubError) {
				if (e.code === 'rate_limited') return fail(429, { error: 'GitHub rate limit exceeded' });
			}
			return fail(500, { error: 'Failed to sync repository info' });
		}
	},

	addProjectResource: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const url = data.get('url')?.toString().trim();
		if (!projectId || !url) return fail(400);
		const label = data.get('label')?.toString().trim() || undefined;
		await addProjectResource(env, locals.userEmail, projectId, url, label);
	},

	deleteProjectResource: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const resourceId = data.get('resourceId')?.toString();
		if (!projectId || !resourceId) return fail(400);
		await deleteProjectResource(env, locals.userEmail, projectId, resourceId);
	},

	addProjectAttachment: async ({ request, locals, platform }) => {
		const env = platform?.env;
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
		const stored = await addProjectAttachment(env, locals.userEmail, projectId, {
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
		const env = platform?.env;
		const r2 = platform!.env.TIFF_ATTACHMENTS;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const attachmentId = data.get('attachmentId')?.toString();
		if (!projectId || !attachmentId) return fail(400);
		const attachment = await deleteProjectAttachment(env, locals.userEmail, projectId, attachmentId);
		if (attachment?.key) await r2.delete(attachment.key);
	}
};
