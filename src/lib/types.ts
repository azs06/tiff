export interface TaskLog {
	id: string;
	text: string;
	createdAt: number;
}

export interface Resource {
	id: string;
	url: string;
	label?: string;
	createdAt: number;
}

export interface Todo {
	id: string;
	title: string;
	done: boolean;
	createdAt: number;
	detail?: string;
	deadline?: number;
	archived?: boolean;
	archivedAt?: number;
	logs?: TaskLog[];
	projectId?: string;
	totalFocusMs?: number;
}

export interface ProjectAttachment {
	id: string;
	name: string;
	url: string;
	key?: string;
	contentType?: string;
	size?: number;
	createdAt: number;
}

export interface ProjectGitHubRepo {
	id: string;
	projectId: string;
	fullName: string;
	owner: string;
	repo: string;
	isPrimary: boolean;
	createdAt: number;
}

export interface Project {
	id: string;
	name: string;
	createdAt: number;
	detail?: string;
	resources?: Resource[];
	attachments?: ProjectAttachment[];
	githubRepos?: ProjectGitHubRepo[];
	archived?: boolean;
	archivedAt?: number;
}

export function getPrimaryProjectGitHubRepo(
	project: Pick<Project, 'githubRepos'> | null | undefined
): ProjectGitHubRepo | undefined {
	const repos = project?.githubRepos;
	if (!repos || repos.length === 0) return undefined;

	return (
		repos.find((repo) => repo.isPrimary) ??
		[...repos].sort((a, b) => a.createdAt - b.createdAt)[0]
	);
}

export interface GitHubRepoInfo {
	fullName: string;
	description: string | null;
	defaultBranch: string;
	lastPushedAt: string;
	stars: number;
	openIssueCount: number;
	lastMergedPr: { number: number; title: string; mergedAt: string; url: string } | null;
	fetchedAt: number;
	error?: string;
	readmeContent?: string;
	readmeFetchedAt?: number;
	readmeUpdatedAt?: string;
}

export interface FocusSession {
	id: string;
	taskId: string;
	startedAt: number;
	endedAt?: number;
	endReason?: 'switch' | 'done' | 'manual' | 'pause';
}

export interface FocusedTaskState {
	taskId: string;
	addedAt: number;
	lastInteractedAt: number;
	sessionStatus: 'running' | 'paused';
	sessionElapsedMs: number;
	sessionStartedAt?: number;
}

export interface FocusState {
	expandedTaskId: string | null;
	tasks: FocusedTaskState[];
}

export interface LegacyFocusState {
	activeTaskId: string;
	focusedAt: number;
	sessionPaused?: boolean;
	pausedAt?: number;
	accumulatedPauseMs?: number;
}

export type Theme = 'signal' | 'paper' | 'nothing';
export const THEMES: Theme[] = ['signal', 'paper', 'nothing'];

export interface UserSettings {
	theme: Theme;
}

export const DEFAULT_SETTINGS: UserSettings = {
	theme: 'signal'
};
