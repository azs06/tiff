export interface Todo {
	id: string;
	title: string;
	done: boolean;
	createdAt: number;
	detail?: string;
	deadline?: number;
	archived?: boolean;
	archivedAt?: number;
}

export type Theme = 'signal' | 'paper' | 'void';
export const THEMES: Theme[] = ['signal', 'paper', 'void'];

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
