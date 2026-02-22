import {
	getTodos,
	getFocus,
	getSettings,
	getPomodoroLogs,
	getProjects,
	getSessions,
	getTimer,
	saveFocus,
	saveTimer
} from '$lib/kv';
import { DEFAULT_SETTINGS, type FocusState } from '$lib/types';

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
			sessions: []
		};
	}

	const email = locals.userEmail;
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

	const todos = allTodos.filter((t) => !t.archived);
	const archivedTodos = allTodos.filter((t) => t.archived);
	return { todos, archivedTodos, serverFocus: focus, settings, pomodoroLogs, projects, sessions };
}
