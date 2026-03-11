import {
	getTodos,
	getFocus,
	getSettings,
	getPomodoroLogs,
	getProjects,
	getSessions,
	getTimer,
	saveFocus,
	saveSessions,
	saveTimer,
	getGitHubInfo,
	saveGitHubInfo,
	hasAnyStorage
} from '$lib/storage';
import {
	DEFAULT_SETTINGS,
	getPrimaryProjectGitHubRepo,
	type LegacyFocusState,
	type GitHubRepoInfo
} from '$lib/types';
import { ensureOpenSession, normalizeFocusState } from '$lib/focus';
import { fetchRepoInfo, isCacheFresh } from '$lib/github';

export async function loadAppData(locals: App.Locals, platform: App.Platform | undefined) {
	const env = platform?.env;

	if (!hasAnyStorage(env)) {
		return {
			todos: [],
			archivedTodos: [],
			serverFocus: null,
			settings: DEFAULT_SETTINGS,
			pomodoroLogs: [],
			projects: [],
			archivedProjects: [],
			sessions: [],
			githubInfo: {} as Record<string, GitHubRepoInfo>,
			hasGithubToken: false
		};
	}

	const email = locals.userEmail;
	const githubToken = env?.GITHUB_TOKEN;

	const [allTodos, serverFocus, settings, pomodoroLogs, projects, storedSessions] = await Promise.all([
		getTodos(env, email),
		getFocus(env, email),
		getSettings(env, email),
		getPomodoroLogs(env, email),
		getProjects(env, email),
		getSessions(env, email)
	]);

	// Legacy compatibility: convert old TimerState records into FocusState on first read.
	let focus = serverFocus;
	let sessions = storedSessions;
	let migratedFocus = false;
	if (!focus) {
		const oldTimer = await getTimer(env, email);
		if (oldTimer) {
			focus = normalizeFocusState({
				activeTaskId: oldTimer.activeTaskId,
				focusedAt: oldTimer.startedAt,
				pomodoro: {
					startedAt: oldTimer.startedAt,
					duration: oldTimer.duration,
					type: oldTimer.type,
					completedPomodoros: oldTimer.completedPomodoros,
					paused: oldTimer.paused,
					pausedRemaining: oldTimer.pausedRemaining
				}
			} satisfies LegacyFocusState);
			migratedFocus = true;
			await saveFocus(env, email, focus);
			await saveTimer(env, email, null);
		}
	}

	const validFocusTaskIds = new Set(allTodos.filter((todo) => !todo.done && !todo.archived).map((todo) => todo.id));
	const prunedFocus = focus
		? normalizeFocusState({
				expandedTaskId: focus.expandedTaskId,
				tasks: focus.tasks.filter((task) => validFocusTaskIds.has(task.taskId))
			})
		: null;

	if (focus && JSON.stringify(prunedFocus) !== JSON.stringify(focus)) {
		focus = prunedFocus;
		await saveFocus(env, email, focus);
	}

	for (const task of focus?.tasks ?? []) {
		if (task.sessionStatus === 'running' && task.sessionStartedAt) {
			const nextSessions = ensureOpenSession(sessions, task.taskId, task.sessionStartedAt);
			if (nextSessions !== sessions) {
				sessions = nextSessions;
				migratedFocus = true;
			}
		}
	}

	if (migratedFocus && sessions !== storedSessions) {
		await saveSessions(env, email, sessions);
	}

	// Load GitHub info for linked project repos
	const githubInfo: Record<string, GitHubRepoInfo> = {};
	const linkedRepos = projects.flatMap((project) => project.githubRepos ?? []);
	if (linkedRepos.length > 0) {
		const results = await Promise.all(
			linkedRepos.map(async (repoLink) => {
				const cached = await getGitHubInfo(env, email, repoLink.id);
				if (cached && isCacheFresh(cached)) return { id: repoLink.id, info: cached };

				if (githubToken) {
					try {
						const fresh = await fetchRepoInfo(repoLink.owner, repoLink.repo, {
							token: githubToken
						});
						if (cached) {
							if (cached.readmeContent) fresh.readmeContent = cached.readmeContent;
							if (cached.readmeFetchedAt) fresh.readmeFetchedAt = cached.readmeFetchedAt;
							if (cached.readmeUpdatedAt) fresh.readmeUpdatedAt = cached.readmeUpdatedAt;
						}
						await saveGitHubInfo(env, email, repoLink.id, fresh);
						return { id: repoLink.id, info: fresh };
					} catch {
						if (cached) return { id: repoLink.id, info: cached };
						const errorInfo: GitHubRepoInfo = {
							fullName: repoLink.fullName,
							description: null,
							defaultBranch: 'main',
							lastPushedAt: '',
							stars: 0,
							openIssueCount: 0,
							lastMergedPr: null,
							fetchedAt: Date.now(),
							error: 'Failed to fetch repository info'
						};
						await saveGitHubInfo(env, email, repoLink.id, errorInfo);
						return { id: repoLink.id, info: errorInfo };
					}
				}

				if (cached) return { id: repoLink.id, info: cached };
				return null;
			})
		);

		for (const result of results) {
			if (result) githubInfo[result.id] = result.info;
		}
	}

	const todos = allTodos.filter((t) => !t.archived);
	const archivedTodos = allTodos.filter((t) => t.archived);
	const activeProjects = projects.filter((p) => !p.archived);
	const archivedProjects = projects.filter((p) => p.archived);

	for (const project of [...activeProjects, ...archivedProjects]) {
		const primaryRepo = getPrimaryProjectGitHubRepo(project);
		if (!primaryRepo) continue;

		project.githubRepos = [
			primaryRepo,
			...(project.githubRepos ?? []).filter((repo) => repo.id !== primaryRepo.id)
		];
	}

	return {
		todos,
		archivedTodos,
		serverFocus: focus,
		settings,
		pomodoroLogs,
		projects: activeProjects,
		archivedProjects,
		sessions,
		githubInfo,
		hasGithubToken: Boolean(githubToken)
	};
}
