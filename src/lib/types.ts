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

export interface Project {
	id: string;
	name: string;
	createdAt: number;
	detail?: string;
	resources?: Resource[];
	attachments?: ProjectAttachment[];
	githubRepo?: string;
	archived?: boolean;
	archivedAt?: number;
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
	endReason?: 'switch' | 'done' | 'manual';
}

export interface FocusState {
	activeTaskId: string;
	focusedAt: number;
	sessionPaused?: boolean;
	pausedAt?: number;
	accumulatedPauseMs?: number;
	pomodoro?: {
		startedAt: number;
		duration: number;
		type: 'work' | 'short-break' | 'long-break';
		completedPomodoros: number;
		paused: boolean;
		pausedRemaining?: number;
	};
}

export type Theme = 'signal' | 'paper' | 'nothing';
export const THEMES: Theme[] = ['signal', 'paper', 'nothing'];

export interface UserSettings {
	workMs: number;
	shortBreakMs: number;
	longBreakMs: number;
	theme: Theme;
}

export const DEFAULT_SETTINGS: UserSettings = {
	workMs: 25 * 60 * 1000,
	shortBreakMs: 5 * 60 * 1000,
	longBreakMs: 15 * 60 * 1000,
	theme: 'signal'
};

export interface TimerState {
	activeTaskId: string;
	startedAt: number;
	duration: number;
	type: 'work' | 'short-break' | 'long-break';
	completedPomodoros: number;
	paused: boolean;
	pausedRemaining?: number;
}

export interface PomodoroLog {
	taskId: string;
	type: 'work' | 'short-break' | 'long-break';
	duration: number;
	completedAt: number;
}
