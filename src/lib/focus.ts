import type {
	FocusPomodoroState,
	FocusedTaskState,
	FocusSession,
	FocusState,
	LegacyFocusState,
	UserSettings
} from './types';
import { nextInterval } from './pomodoro';

type MaybeFocusState = FocusState | LegacyFocusState | null | undefined;

function clonePomodoro(pomodoro?: FocusPomodoroState): FocusPomodoroState | undefined {
	if (!pomodoro) return undefined;
	return { ...pomodoro };
}

function cloneTask(task: FocusedTaskState): FocusedTaskState {
	return {
		...task,
		pomodoro: clonePomodoro(task.pomodoro)
	};
}

function sortTasks(tasks: FocusedTaskState[]): FocusedTaskState[] {
	return tasks.slice().sort((a, b) => b.lastInteractedAt - a.lastInteractedAt);
}

function finalizeFocus(tasks: FocusedTaskState[], expandedTaskId?: string | null): FocusState | null {
	if (tasks.length === 0) return null;
	const sorted = sortTasks(tasks);
	const nextExpanded =
		expandedTaskId && sorted.some((task) => task.taskId === expandedTaskId)
			? expandedTaskId
			: sorted[0].taskId;
	return {
		expandedTaskId: nextExpanded,
		tasks: sorted
	};
}

export function isLegacyFocusState(value: MaybeFocusState): value is LegacyFocusState {
	return Boolean(value && 'activeTaskId' in value);
}

export function normalizeFocusState(value: MaybeFocusState): FocusState | null {
	if (!value) return null;
	if (isLegacyFocusState(value)) return migrateLegacyFocusState(value);
	if (!Array.isArray(value.tasks) || value.tasks.length === 0) return null;
	const tasks: FocusedTaskState[] = value.tasks
		.filter((task): task is FocusedTaskState => Boolean(task?.taskId))
		.map((task) => ({
			taskId: task.taskId,
			addedAt: task.addedAt ?? task.lastInteractedAt ?? Date.now(),
			lastInteractedAt: task.lastInteractedAt ?? task.addedAt ?? Date.now(),
			sessionStatus: task.sessionStatus === 'paused' ? 'paused' : 'running',
			sessionElapsedMs: Math.max(0, task.sessionElapsedMs ?? 0),
			sessionStartedAt:
				task.sessionStatus === 'running'
					? task.sessionStartedAt ?? Date.now()
					: undefined,
			pomodoro: clonePomodoro(task.pomodoro)
		}));
	return finalizeFocus(tasks, value.expandedTaskId);
}

export function migrateLegacyFocusState(legacy: LegacyFocusState): FocusState {
	const pausedDuration = legacy.sessionPaused && legacy.pausedAt ? Date.now() - legacy.pausedAt : 0;
	const elapsed = Math.max(
		0,
		Date.now() - legacy.focusedAt - (legacy.accumulatedPauseMs ?? 0) - pausedDuration
	);
	return {
		expandedTaskId: legacy.activeTaskId,
		tasks: [
			{
				taskId: legacy.activeTaskId,
				addedAt: legacy.focusedAt,
				lastInteractedAt: legacy.focusedAt,
				sessionStatus: legacy.sessionPaused ? 'paused' : 'running',
				sessionElapsedMs: elapsed,
				sessionStartedAt: legacy.sessionPaused ? undefined : legacy.focusedAt,
				pomodoro: clonePomodoro(legacy.pomodoro)
			}
		]
	};
}

export function focusTaskIds(focus: FocusState | null): Set<string> {
	return new Set((focus?.tasks ?? []).map((task) => task.taskId));
}

export function getFocusedTask(focus: FocusState | null, taskId: string): FocusedTaskState | null {
	return focus?.tasks.find((task) => task.taskId === taskId) ?? null;
}

export function getExpandedFocusedTask(focus: FocusState | null): FocusedTaskState | null {
	if (!focus?.expandedTaskId) return focus?.tasks[0] ?? null;
	return getFocusedTask(focus, focus.expandedTaskId);
}

export function getSessionElapsed(task: FocusedTaskState, now = Date.now()): number {
	return task.sessionStatus === 'running'
		? task.sessionElapsedMs + Math.max(0, now - (task.sessionStartedAt ?? now))
		: task.sessionElapsedMs;
}

export function getPomodoroRemaining(task: FocusedTaskState, now = Date.now()): number {
	if (!task.pomodoro) return 0;
	if (task.pomodoro.paused) return Math.max(0, task.pomodoro.pausedRemaining ?? 0);
	return Math.max(0, task.pomodoro.startedAt + task.pomodoro.duration - now);
}

export function hasExpiredPomodoro(task: FocusedTaskState, now = Date.now()): boolean {
	return Boolean(task.pomodoro) && getPomodoroRemaining(task, now) === 0;
}

export function getDisplayTimer(task: FocusedTaskState, now = Date.now()): number {
	return task.pomodoro ? getPomodoroRemaining(task, now) : getSessionElapsed(task, now);
}

export function upsertFocusedTask(
	focus: FocusState | null,
	taskId: string,
	now = Date.now()
): FocusState {
	const existing = getFocusedTask(focus, taskId);
	if (existing) {
		const tasks = (focus?.tasks ?? []).map((task) =>
			task.taskId === taskId ? { ...cloneTask(task), lastInteractedAt: now } : cloneTask(task)
		);
		return finalizeFocus(tasks, taskId) as FocusState;
	}

	const task: FocusedTaskState = {
		taskId,
		addedAt: now,
		lastInteractedAt: now,
		sessionStatus: 'running',
		sessionElapsedMs: 0,
		sessionStartedAt: now
	};
	return finalizeFocus([...(focus?.tasks ?? []).map(cloneTask), task], taskId) as FocusState;
}

export function expandFocusedTask(
	focus: FocusState | null,
	taskId: string,
	now = Date.now()
): FocusState | null {
	if (!focus) return null;
	const tasks = focus.tasks.map((task) =>
		task.taskId === taskId ? { ...cloneTask(task), lastInteractedAt: now } : cloneTask(task)
	);
	return finalizeFocus(tasks, taskId);
}

export function pauseFocusedTask(focus: FocusState | null, taskId: string, now = Date.now()): FocusState | null {
	if (!focus) return null;
	const tasks = focus.tasks.map((task) => {
		if (task.taskId !== taskId) return cloneTask(task);
		const next = cloneTask(task);
		if (next.sessionStatus === 'running') {
			next.sessionElapsedMs = getSessionElapsed(next, now);
			next.sessionStatus = 'paused';
			delete next.sessionStartedAt;
		}
		if (next.pomodoro && !next.pomodoro.paused) {
			next.pomodoro = {
				...next.pomodoro,
				paused: true,
				pausedRemaining: getPomodoroRemaining(next, now)
			};
		}
		return next;
	});
	return finalizeFocus(tasks, focus.expandedTaskId);
}

export function resumeFocusedTask(
	focus: FocusState | null,
	taskId: string,
	now = Date.now()
): FocusState | null {
	if (!focus) return null;
	const tasks = focus.tasks.map((task) => {
		if (task.taskId !== taskId) return cloneTask(task);
		const next = cloneTask(task);
		if (next.sessionStatus === 'paused') {
			next.sessionStatus = 'running';
			next.sessionStartedAt = now;
		}
		if (next.pomodoro?.paused) {
			const remaining = Math.max(0, next.pomodoro.pausedRemaining ?? 0);
			next.pomodoro = {
				...next.pomodoro,
				startedAt: now,
				duration: remaining,
				paused: false,
				pausedRemaining: undefined
			};
		}
		next.lastInteractedAt = now;
		return next;
	});
	return finalizeFocus(tasks, focus.expandedTaskId === taskId ? taskId : focus.expandedTaskId);
}

export function stopFocusedTask(focus: FocusState | null, taskId: string): FocusState | null {
	if (!focus) return null;
	const tasks = focus.tasks.filter((task) => task.taskId !== taskId).map(cloneTask);
	return finalizeFocus(tasks, focus.expandedTaskId === taskId ? null : focus.expandedTaskId);
}

export function removeFocusedTask(focus: FocusState | null, taskId: string): FocusState | null {
	return stopFocusedTask(focus, taskId);
}

export function startTaskPomodoro(
	focus: FocusState | null,
	taskId: string,
	settings: UserSettings,
	now = Date.now()
): FocusState | null {
	if (!focus) return null;
	const tasks: FocusedTaskState[] = focus.tasks.map((task) =>
		task.taskId === taskId
			? {
					...cloneTask(task),
					pomodoro: {
						startedAt: now,
						duration: settings.workMs,
						type: 'work',
						completedPomodoros: task.pomodoro?.completedPomodoros ?? 0,
						paused: false
					}
				}
			: cloneTask(task)
	);
	return finalizeFocus(tasks, focus.expandedTaskId);
}

export function pauseTaskPomodoro(focus: FocusState | null, taskId: string, now = Date.now()): FocusState | null {
	if (!focus) return null;
	const tasks = focus.tasks.map((task) => {
		if (task.taskId !== taskId || !task.pomodoro || task.pomodoro.paused) return cloneTask(task);
		const remaining = getPomodoroRemaining(task, now);
		return {
			...cloneTask(task),
			pomodoro: {
				...task.pomodoro,
				paused: true,
				pausedRemaining: remaining
			}
		};
	});
	return finalizeFocus(tasks, focus.expandedTaskId);
}

export function resumeTaskPomodoro(focus: FocusState | null, taskId: string, now = Date.now()): FocusState | null {
	if (!focus) return null;
	const tasks = focus.tasks.map((task) => {
		if (task.taskId !== taskId || !task.pomodoro?.paused) return cloneTask(task);
		const remaining = Math.max(0, task.pomodoro.pausedRemaining ?? 0);
		return {
			...cloneTask(task),
			pomodoro: {
				...task.pomodoro,
				startedAt: now,
				duration: remaining,
				paused: false,
				pausedRemaining: undefined
			}
		};
	});
	return finalizeFocus(tasks, focus.expandedTaskId);
}

export function resetTaskPomodoro(
	focus: FocusState | null,
	taskId: string,
	settings: UserSettings,
	now = Date.now()
): FocusState | null {
	if (!focus) return null;
	const tasks = focus.tasks.map((task) => {
		if (task.taskId !== taskId || !task.pomodoro) return cloneTask(task);
		const duration =
			task.pomodoro.type === 'work'
				? settings.workMs
				: task.pomodoro.type === 'short-break'
					? settings.shortBreakMs
					: settings.longBreakMs;
		return {
			...cloneTask(task),
			pomodoro: {
				...task.pomodoro,
				startedAt: now,
				duration,
				paused: false,
				pausedRemaining: undefined
			}
		};
	});
	return finalizeFocus(tasks, focus.expandedTaskId);
}

export function advanceTaskPomodoro(
	focus: FocusState | null,
	taskId: string,
	settings: UserSettings,
	now = Date.now()
): { focus: FocusState | null; logEntry: { taskId: string; type: FocusPomodoroState['type']; duration: number } | null } {
	if (!focus) return { focus: null, logEntry: null };
	let logEntry: { taskId: string; type: FocusPomodoroState['type']; duration: number } | null = null;
	const tasks: FocusedTaskState[] = focus.tasks.map((task) => {
		if (task.taskId !== taskId || !task.pomodoro) return cloneTask(task);
		const completed =
			task.pomodoro.type === 'work'
				? task.pomodoro.completedPomodoros + 1
				: task.pomodoro.completedPomodoros;
		const next: { type: FocusPomodoroState['type']; duration: number } =
			task.pomodoro.type === 'work'
				? nextInterval(completed, settings)
				: { type: 'work', duration: settings.workMs };
		logEntry = {
			taskId,
			type: task.pomodoro.type,
			duration: task.pomodoro.duration
		};
		return {
			...cloneTask(task),
			pomodoro: {
				startedAt: now,
				duration: next.duration,
				type: next.type,
				completedPomodoros: completed,
				paused: false
			}
		};
	});
	return { focus: finalizeFocus(tasks, focus.expandedTaskId), logEntry };
}

export function stopTaskPomodoro(focus: FocusState | null, taskId: string): FocusState | null {
	if (!focus) return null;
	const tasks = focus.tasks.map((task) => {
		if (task.taskId !== taskId || !task.pomodoro) return cloneTask(task);
		return {
			...cloneTask(task),
			pomodoro: {
				...task.pomodoro,
				paused: true,
				pausedRemaining: 0
			}
		};
	});
	return finalizeFocus(tasks, focus.expandedTaskId);
}

export function dismissTaskPomodoro(focus: FocusState | null, taskId: string): FocusState | null {
	if (!focus) return null;
	const tasks = focus.tasks.map((task) => {
		if (task.taskId !== taskId) return cloneTask(task);
		const next = cloneTask(task);
		delete next.pomodoro;
		return next;
	});
	return finalizeFocus(tasks, focus.expandedTaskId);
}

export function ensureOpenSession(
	sessions: FocusSession[],
	taskId: string,
	startedAt: number
): FocusSession[] {
	if (sessions.some((session) => session.taskId === taskId && !session.endedAt)) return sessions;
	return [
		...sessions,
		{
			id: crypto.randomUUID(),
			taskId,
			startedAt
		}
	];
}
