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
	expandFocusTaskTx,
	focusTaskTx,
	pauseFocusTaskTx,
	resumeFocusTaskTx,
	stopFocusTaskTx,
	startTaskPomodoroTx,
	pauseTaskPomodoroTx,
	resumeTaskPomodoroTx,
	resetTaskPomodoroTx,
	advanceTaskPomodoroTx,
	stopTaskPomodoroTx,
	dismissTaskPomodoroTx,
	toggleTodoAndHandleFocusTx,
	deleteProjectCascadeTx
} from '$lib/storage';
import {
	THEMES,
	getPrimaryProjectGitHubRepo,
	type Project,
	type ProjectGitHubRepo,
	type UserSettings,
	type Theme
} from '$lib/types';
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

function normalizeRepoKey(fullName: string): string {
	return fullName.trim().toLowerCase();
}

function getProjectRepos(project: Project): ProjectGitHubRepo[] {
	return project.githubRepos ?? [];
}

function sortProjectRepos(repos: ProjectGitHubRepo[]): ProjectGitHubRepo[] {
	return [...repos].sort((a, b) => {
		if (a.isPrimary !== b.isPrimary) return Number(b.isPrimary) - Number(a.isPrimary);
		return a.createdAt - b.createdAt;
	});
}

function setPrimaryRepo(project: Project, repoLinkId: string): boolean {
	const repos = getProjectRepos(project);
	if (repos.length === 0) return false;

	if (!repos.some((repo) => repo.id === repoLinkId)) return false;

	project.githubRepos = repos.map((repo) => ({
		...repo,
		isPrimary: repo.id === repoLinkId
	}));
	return true;
}

function removeProjectRepo(project: Project, repoLinkId: string): ProjectGitHubRepo | null {
	const repos = getProjectRepos(project);
	const removed = repos.find((repo) => repo.id === repoLinkId) ?? null;
	if (!removed) return null;

	const remaining = repos.filter((repo) => repo.id !== repoLinkId);
	if (remaining.length === 0) {
		delete project.githubRepos;
		return removed;
	}

	const nextPrimaryId =
		remaining.find((repo) => repo.isPrimary)?.id ??
		[...remaining].sort((a, b) => a.createdAt - b.createdAt)[0]?.id;

	project.githubRepos = sortProjectRepos(
		remaining.map((repo) => ({
			...repo,
			isPrimary: repo.id === nextPrimaryId
		}))
	);
	return removed;
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
		await stopFocusTaskTx(env, locals.userEmail, id, 'manual');
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

	focusTask: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await focusTaskTx(env, locals.userEmail, taskId);
	},

	expandFocusTask: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await expandFocusTaskTx(env, locals.userEmail, taskId);
	},

	pauseFocusTask: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await pauseFocusTaskTx(env, locals.userEmail, taskId);
	},

	resumeFocusTask: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await resumeFocusTaskTx(env, locals.userEmail, taskId);
	},

	stopFocusTask: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await stopFocusTaskTx(env, locals.userEmail, taskId, 'manual');
	},

	unfocus: async ({ locals, platform }) => {
		void locals;
		void platform;
		return fail(400, { error: 'Unfocus all is no longer supported from the UI' });
	},

	startTaskPomodoro: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await startTaskPomodoroTx(env, locals.userEmail, taskId);
	},

	pauseTaskPomodoro: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await pauseTaskPomodoroTx(env, locals.userEmail, taskId);
	},

	resumeTaskPomodoro: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await resumeTaskPomodoroTx(env, locals.userEmail, taskId);
	},

	resetTaskPomodoro: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await resetTaskPomodoroTx(env, locals.userEmail, taskId);
	},

	advanceTaskPomodoro: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await advanceTaskPomodoroTx(env, locals.userEmail, taskId);
	},

	stopTaskPomodoro: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await stopTaskPomodoroTx(env, locals.userEmail, taskId);
	},

	dismissTaskPomodoro: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const taskId = data.get('taskId')?.toString();
		if (!taskId) return fail(400);
		await dismissTaskPomodoroTx(env, locals.userEmail, taskId);
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
		let githubRepoLink: ProjectGitHubRepo | undefined;

		if (repoRaw) {
			const parsed = parseGitHubRepo(repoRaw);
			if (!parsed) return fail(400, { error: 'Invalid GitHub repo format' });
			const projectId = crypto.randomUUID();
			githubRepoLink = {
				id: crypto.randomUUID(),
				projectId,
				fullName: `${parsed.owner}/${parsed.repo}`,
				owner: parsed.owner,
				repo: parsed.repo,
				isPrimary: true,
				createdAt: Date.now()
			};

			const project: Project = {
				id: projectId,
				name,
				createdAt: githubRepoLink.createdAt
			};

			let readmeDetail: string | undefined;
			if (platform?.env.GITHUB_TOKEN) {
				try {
					const [info, readmeResult] = await Promise.all([
						fetchRepoInfo(parsed.owner, parsed.repo, {
							token: platform.env.GITHUB_TOKEN
						}),
						fetchReadme(parsed.owner, parsed.repo, {
							token: platform.env.GITHUB_TOKEN
						})
					]);
					githubRepoLink = {
						...githubRepoLink,
						fullName: info.fullName
					};
					if (readmeResult) {
						info.readmeContent = readmeResult.content;
						info.readmeFetchedAt = Date.now();
						if (readmeResult.updatedAt) info.readmeUpdatedAt = readmeResult.updatedAt;
						if (!detail) readmeDetail = readmeResult.content;
					}
					await saveGitHubInfo(env, locals.userEmail, githubRepoLink.id, info);
				} catch {
					// Non-fatal: cache will be populated on next page load
				}
			}

			project.githubRepos = [githubRepoLink];
			if (detail || readmeDetail) project.detail = detail ?? readmeDetail;

			const projects = await getProjects(env, locals.userEmail);
			projects.push(project);
			await saveProjects(env, locals.userEmail, projects);
			return;
		}

		const projects = await getProjects(env, locals.userEmail);
		projects.push({
			id: crypto.randomUUID(),
			name,
			createdAt: Date.now(),
			...(detail ? { detail } : {})
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

		const projects = await getProjects(env, locals.userEmail);
		const project = projects.find((entry) => entry.id === id);
		const { attachmentKeys: keys } = await deleteProjectCascadeTx(env, locals.userEmail, id);
		if (keys.length > 0) await r2.delete(keys);
		for (const repo of project?.githubRepos ?? []) {
			await deleteGitHubInfo(env, locals.userEmail, repo.id);
		}
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

	addProjectGithubRepo: async ({ request, locals, platform }) => {
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
		if (
			getProjectRepos(project).some(
				(entry) =>
					normalizeRepoKey(entry.fullName) === normalizeRepoKey(`${parsed.owner}/${parsed.repo}`)
			)
		) {
			return fail(400, { error: 'Repository already linked to this project' });
		}

		try {
			const [info, readmeResult] = await Promise.all([
				fetchRepoInfo(parsed.owner, parsed.repo, { token }),
				fetchReadme(parsed.owner, parsed.repo, { token })
			]);
			const repoLink: ProjectGitHubRepo = {
				id: crypto.randomUUID(),
				projectId: project.id,
				fullName: info.fullName,
				owner: parsed.owner,
				repo: parsed.repo,
				isPrimary: getProjectRepos(project).length === 0,
				createdAt: Date.now()
			};
			project.githubRepos = sortProjectRepos([...(project.githubRepos ?? []), repoLink]);

			if (readmeResult) {
				info.readmeContent = readmeResult.content;
				info.readmeFetchedAt = Date.now();
				if (readmeResult.updatedAt) info.readmeUpdatedAt = readmeResult.updatedAt;
				if (repoLink.isPrimary && !project.detail) project.detail = readmeResult.content;
			}

			await saveProjects(env, locals.userEmail, projects);
			await saveGitHubInfo(env, locals.userEmail, repoLink.id, info);
		} catch (e) {
			if (e instanceof GitHubError) {
				if (e.code === 'not_found') return fail(400, { error: 'Repository not found' });
				if (e.code === 'rate_limited') return fail(429, { error: 'GitHub rate limit exceeded' });
			}
			return fail(500, { error: 'Failed to fetch repository info' });
		}
	},

	setPrimaryProjectGithubRepo: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const repoLinkId = data.get('repoLinkId')?.toString();
		if (!projectId || !repoLinkId) return fail(400);

		const projects = await getProjects(env, locals.userEmail);
		const project = projects.find((p) => p.id === projectId);
		if (!project) return fail(400, { error: 'Project not found' });
		if (!setPrimaryRepo(project, repoLinkId)) {
			return fail(400, { error: 'Repository not found' });
		}

		project.githubRepos = sortProjectRepos(project.githubRepos ?? []);
		await saveProjects(env, locals.userEmail, projects);
	},

	syncProjectReadmeFromPrimary: async ({ request, locals, platform }) => {
		const token = platform?.env.GITHUB_TOKEN;
		if (!token) return fail(400, { error: 'GitHub integration not configured' });

		const env = platform?.env;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		if (!projectId) return fail(400);

		const projects = await getProjects(env, locals.userEmail);
		const project = projects.find((p) => p.id === projectId);
		const primaryRepo = getPrimaryProjectGitHubRepo(project);
		if (!project || !primaryRepo) return fail(400, { error: 'No GitHub repo linked' });

		const readmeResult = await fetchReadme(primaryRepo.owner, primaryRepo.repo, { token });
		if (!readmeResult) return fail(404, { error: 'README not found in repository' });

		project.detail = readmeResult.content;
		await saveProjects(env, locals.userEmail, projects);

		const existing = await getGitHubInfo(env, locals.userEmail, primaryRepo.id);
		const info =
			existing ??
			(await fetchRepoInfo(primaryRepo.owner, primaryRepo.repo, {
				token
			}));
		info.readmeContent = readmeResult.content;
		info.readmeFetchedAt = Date.now();
		if (readmeResult.updatedAt) info.readmeUpdatedAt = readmeResult.updatedAt;
		await saveGitHubInfo(env, locals.userEmail, primaryRepo.id, info);
	},

	removeProjectGithubRepo: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const repoLinkId = data.get('repoLinkId')?.toString();
		if (!projectId || !repoLinkId) return fail(400);

		const projects = await getProjects(env, locals.userEmail);
		const project = projects.find((p) => p.id === projectId);
		if (!project) return fail(400, { error: 'Project not found' });

		const removed = removeProjectRepo(project, repoLinkId);
		if (!removed) return fail(400, { error: 'Repository not found' });
		await saveProjects(env, locals.userEmail, projects);
		await deleteGitHubInfo(env, locals.userEmail, removed.id);
	},

	syncProjectGithubRepo: async ({ request, locals, platform }) => {
		const env = platform?.env;
		const token = platform?.env.GITHUB_TOKEN;
		if (!token) return fail(400, { error: 'GitHub integration not configured' });

		const data = await request.formData();
		const projectId = data.get('projectId')?.toString();
		const repoLinkId = data.get('repoLinkId')?.toString();
		if (!projectId || !repoLinkId) return fail(400);

		const projects = await getProjects(env, locals.userEmail);
		const project = projects.find((p) => p.id === projectId);
		if (!project) return fail(400, { error: 'Project not found' });
		const repoLink = getProjectRepos(project).find((repo) => repo.id === repoLinkId);
		if (!repoLink) return fail(400, { error: 'Repository not found' });

		try {
			const [info, readmeResult] = await Promise.all([
				fetchRepoInfo(repoLink.owner, repoLink.repo, { token }),
				fetchReadme(repoLink.owner, repoLink.repo, { token })
			]);
			if (readmeResult) {
				info.readmeContent = readmeResult.content;
				info.readmeFetchedAt = Date.now();
				if (readmeResult.updatedAt) info.readmeUpdatedAt = readmeResult.updatedAt;
			}
			await saveGitHubInfo(env, locals.userEmail, repoLink.id, info);
		} catch (e) {
			if (e instanceof GitHubError) {
				if (e.code === 'rate_limited') return fail(429, { error: 'GitHub rate limit exceeded' });
				if (e.code === 'not_found') return fail(400, { error: 'Repository not found' });
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
