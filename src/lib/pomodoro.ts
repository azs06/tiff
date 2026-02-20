import type { TimerState } from './types';

export const WORK_MS = 25 * 60 * 1000;
export const SHORT_BREAK_MS = 5 * 60 * 1000;
export const LONG_BREAK_MS = 15 * 60 * 1000;
export const POMODOROS_BEFORE_LONG_BREAK = 4;

export function nextInterval(completedPomodoros: number): { type: TimerState['type']; duration: number } {
	if (completedPomodoros > 0 && completedPomodoros % POMODOROS_BEFORE_LONG_BREAK === 0) {
		return { type: 'long-break', duration: LONG_BREAK_MS };
	}
	return { type: 'short-break', duration: SHORT_BREAK_MS };
}
