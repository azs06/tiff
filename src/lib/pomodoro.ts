import type { TimerState, UserSettings } from './types';
import { DEFAULT_SETTINGS } from './types';

export const WORK_MS = DEFAULT_SETTINGS.workMs;
export const SHORT_BREAK_MS = DEFAULT_SETTINGS.shortBreakMs;
export const LONG_BREAK_MS = DEFAULT_SETTINGS.longBreakMs;
export const POMODOROS_BEFORE_LONG_BREAK = 4;

export function nextInterval(
	completedPomodoros: number,
	settings?: UserSettings
): { type: TimerState['type']; duration: number } {
	const shortMs = settings?.shortBreakMs ?? SHORT_BREAK_MS;
	const longMs = settings?.longBreakMs ?? LONG_BREAK_MS;
	if (completedPomodoros > 0 && completedPomodoros % POMODOROS_BEFORE_LONG_BREAK === 0) {
		return { type: 'long-break', duration: longMs };
	}
	return { type: 'short-break', duration: shortMs };
}
