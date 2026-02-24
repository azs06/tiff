import {
	getTodos,
	getFocus,
	getSettings,
	getPomodoroLogs,
	getProjects,
	getSessions,
	getTimer,
	saveFocus,
	saveTimer,
	getGitHubInfo,
	saveGitHubInfo
} from '$lib/kv';
import { DEFAULT_SETTINGS, type FocusState, type GitHubRepoInfo } from '$lib/types';
import { parseGitHubRepo, fetchRepoInfo, isCacheFresh } from '$lib/github';

export async function loadAppData(locals: App.Locals, platform: App.Platform | undefined) {
	const kv = platform?.env.TIFF_KV;
	if (!kv) {
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
	const githubToken = platform?.env.GITHUB_TOKEN;

	const [allTodos, serverFocus, settings, pomodoroLogs, projects, sessions] = await Promise.all([
		getTodos(kv, email),
		getFocus(kv, email),
		getSettings(kv, email),
		getPomodoroLogs(kv, email),
		getProjects(kv, email),
		getSessions(kv, email)
	]);

	// Migration: convert old TimerState to FocusState
	let focus = serverFocus;
	if (!focus) {
		const oldTimer = await getTimer(kv, email);
		if (oldTimer) {
			focus = {
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
			} satisfies FocusState;
			await saveFocus(kv, email, focus);
			await saveTimer(kv, email, null);
		}
	}

	// Load GitHub info for linked projects
	const githubInfo: Record<string, GitHubRepoInfo> = {};
	const linkedProjects = projects.filter((p) => p.githubRepo);
	if (linkedProjects.length > 0) {
		const results = await Promise.all(
			linkedProjects.map(async (p) => {
				const cached = await getGitHubInfo(kv, email, p.id);
				if (cached && isCacheFresh(cached)) return { id: p.id, info: cached };

				if (githubToken && p.githubRepo) {
					const parsed = parseGitHubRepo(p.githubRepo);
					if (parsed) {
						try {
							const fresh = await fetchRepoInfo(parsed.owner, parsed.repo, {
								token: githubToken
							});
							if (cached) {
								if (cached.readmeContent) fresh.readmeContent = cached.readmeContent;
								if (cached.readmeFetchedAt) fresh.readmeFetchedAt = cached.readmeFetchedAt;
								if (cached.readmeUpdatedAt) fresh.readmeUpdatedAt = cached.readmeUpdatedAt;
							}
							await saveGitHubInfo(kv, email, p.id, fresh);
							return { id: p.id, info: fresh };
						} catch {
							if (cached) return { id: p.id, info: cached };
							const errorInfo: GitHubRepoInfo = {
								fullName: p.githubRepo,
								description: null,
								defaultBranch: 'main',
								lastPushedAt: '',
								stars: 0,
								openIssueCount: 0,
								lastMergedPr: null,
								fetchedAt: Date.now(),
								error: 'Failed to fetch repository info'
							};
							await saveGitHubInfo(kv, email, p.id, errorInfo);
							return { id: p.id, info: errorInfo };
						}
					}
				}

				if (cached) return { id: p.id, info: cached };
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
