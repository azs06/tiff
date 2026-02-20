export interface Todo {
	id: string;
	title: string;
	done: boolean;
	createdAt: number;
	detail?: string;
	deadline?: number;
}

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
