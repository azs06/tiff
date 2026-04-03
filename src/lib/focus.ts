import type { FocusedTaskState, FocusSession, FocusState, LegacyFocusState } from './types';

type MaybeFocusState = FocusState | LegacyFocusState | null | undefined;

function cloneTask(task: FocusedTaskState): FocusedTaskState {
	return { ...task };
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
	const now = Date.now();
	const tasks: FocusedTaskState[] = value.tasks
		.filter((task): task is FocusedTaskState => Boolean(task?.taskId))
		.map((task) => ({
			taskId: task.taskId,
			addedAt: task.addedAt ?? task.lastInteractedAt ?? now,
			lastInteractedAt: task.lastInteractedAt ?? task.addedAt ?? now,
			sessionStartedAt: task.sessionStartedAt ?? now
		}));
	return finalizeFocus(tasks, value.expandedTaskId);
}

export function migrateLegacyFocusState(legacy: LegacyFocusState): FocusState {
	return {
		expandedTaskId: legacy.activeTaskId,
		tasks: [
			{
				taskId: legacy.activeTaskId,
				addedAt: legacy.focusedAt,
				lastInteractedAt: legacy.focusedAt,
				sessionStartedAt: legacy.focusedAt
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
	return Math.max(0, now - task.sessionStartedAt);
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

export function stopFocusedTask(focus: FocusState | null, taskId: string): FocusState | null {
	if (!focus) return null;
	const tasks = focus.tasks.filter((task) => task.taskId !== taskId).map(cloneTask);
	return finalizeFocus(tasks, focus.expandedTaskId === taskId ? null : focus.expandedTaskId);
}

export function removeFocusedTask(focus: FocusState | null, taskId: string): FocusState | null {
	return stopFocusedTask(focus, taskId);
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
