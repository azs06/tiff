<script lang="ts">
	import { enhance } from "$app/forms";
	import { tick } from "svelte";
	import type { PageData } from "./$types";
	import type { FocusState, PomodoroLog, FocusSession } from "$lib/types";
	import { nextInterval } from "$lib/pomodoro";

	let { data }: { data: PageData } = $props();

	let timezoneOffset = $state(0);
	let deadlineChoice = $state<"none" | "today" | "tomorrow" | "custom">(
		"none",
	);
	let customDeadline = $state("");
	let createProjectId = $state("");

	let editDetail = $state("");
	let editDeadlineChoice = $state<"none" | "today" | "tomorrow" | "custom">(
		"none",
	);
	let editCustomDeadline = $state("");

	$effect(() => {
		timezoneOffset = new Date().getTimezoneOffset();
	});

	let createDeadlineValue = $derived(
		deadlineChoice === "today"
			? "today"
			: deadlineChoice === "tomorrow"
				? "tomorrow"
				: deadlineChoice === "custom"
					? customDeadline
					: "",
	);

	let editDeadlineValue = $derived(
		editDeadlineChoice === "today"
			? "today"
			: editDeadlineChoice === "tomorrow"
				? "tomorrow"
				: editDeadlineChoice === "custom"
					? editCustomDeadline
					: "",
	);

	function formatDeadline(ms: number): string {
		const d = new Date(ms);
		const months = [
			"JAN",
			"FEB",
			"MAR",
			"APR",
			"MAY",
			"JUN",
			"JUL",
			"AUG",
			"SEP",
			"OCT",
			"NOV",
			"DEC",
		];
		const month = months[d.getMonth()];
		const day = d.getDate();
		const h = d.getHours();
		const m = d.getMinutes();
		if (h === 23 && m === 59) return `${month} ${day}`;
		return `${month} ${day} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	}

	function isOverdue(ms: number): boolean {
		return Date.now() > ms;
	}

	let focus = $state<FocusState | null>(null);
	let syncFocusFormEl: HTMLFormElement;
	let focusFormEl: HTMLFormElement;
	let unfocusFormEl: HTMLFormElement;
	let focusJson = $derived(focus ? JSON.stringify(focus) : "null");

	let focusHydrated = false;
	$effect(() => {
		if (focusHydrated) return;
		focusHydrated = true;
		const server: FocusState | null = data.serverFocus;
		if (server) {
			focus = server;
			localStorage.setItem("tiff-focus", JSON.stringify(server));
		} else {
			localStorage.removeItem("tiff-focus");
		}
	});

	function setFocus(next: FocusState | null) {
		focus = next;
		if (next) {
			localStorage.setItem("tiff-focus", JSON.stringify(next));
		} else {
			localStorage.removeItem("tiff-focus");
		}
		syncFocusFormEl?.requestSubmit();
	}

	$effect(() => {
		if (
			focus &&
			!data.todos.some(
				(t: { id: string }) => t.id === focus!.activeTaskId,
			)
		) {
			setFocus(null);
		}
	});

	let focusedTodo = $derived(
		focus
			? data.todos.find(
					(t: { id: string }) => t.id === focus!.activeTaskId,
				)
			: null,
	);

	$effect(() => {
		if (focus && focusedTodo?.done) {
			setFocus(null);
		}
	});

	let sessionElapsed = $state(0);

	$effect(() => {
		if (!focus) {
			sessionElapsed = 0;
			return;
		}
		const start = focus.focusedAt;
		const accumulated = focus.accumulatedPauseMs ?? 0;

		if (focus.sessionPaused) {
			const pausedDuration = focus.pausedAt ? Date.now() - focus.pausedAt : 0;
			sessionElapsed = Date.now() - start - accumulated - pausedDuration;
			return;
		}

		const tick = () => {
			sessionElapsed = Date.now() - start - accumulated;
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	});

	function formatElapsed(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		if (hours > 0) {
			return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
		}
		return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	}

	let pomoRemaining = $state(0);
	let pomoExpired = $state(false);
	let logFormEl: HTMLFormElement;

	$effect(() => {
		if (!focus?.pomodoro) {
			pomoRemaining = 0;
			pomoExpired = false;
			return;
		}

		const pomo = focus.pomodoro;
		if (pomo.paused) {
			pomoRemaining = Math.max(0, pomo.pausedRemaining ?? 0);
			pomoExpired = pomoRemaining === 0;
			return;
		}

		const { startedAt, duration } = pomo;
		const tick = () => {
			pomoRemaining = Math.max(0, startedAt + duration - Date.now());
			pomoExpired = pomoRemaining === 0;
		};

		tick();
		const intervalId = setInterval(tick, 1000);
		return () => clearInterval(intervalId);
	});

	let pomoLabel = $derived(
		focus?.pomodoro
			? focus.pomodoro.type === "work"
				? "WORK"
				: focus.pomodoro.type === "short-break"
					? "SHORT BREAK"
					: "LONG BREAK"
			: "",
	);

	let cyclesFilled = $derived(
		focus?.pomodoro ? focus.pomodoro.completedPomodoros % 4 : 0,
	);

	function formatTime(ms: number): string {
		const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	}

	function scrollFocusedHeroIntoView() {
		const hero = document.querySelector('.hero-focus');
		if (!(hero instanceof HTMLElement)) return;
		hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function focusOnTask(taskId: string) {
		setFocus({
			activeTaskId: taskId,
			focusedAt: Date.now(),
			sessionPaused: false,
			pausedAt: undefined,
			accumulatedPauseMs: 0,
		});
		tick().then(() => {
			focusFormEl?.requestSubmit();
			scrollFocusedHeroIntoView();
		});
	}

	function unfocusTask() {
		setFocus(null);
		unfocusFormEl?.requestSubmit();
	}

	function pauseSession() {
		if (!focus || focus.sessionPaused) return;
		setFocus({
			...focus,
			sessionPaused: true,
			pausedAt: Date.now(),
		});
	}

	function resumeSession() {
		if (!focus || !focus.sessionPaused) return;
		const pausedDuration = focus.pausedAt ? Date.now() - focus.pausedAt : 0;
		setFocus({
			...focus,
			sessionPaused: false,
			pausedAt: undefined,
			accumulatedPauseMs: (focus.accumulatedPauseMs ?? 0) + pausedDuration,
		});
	}

	function startPomodoro() {
		if (!focus) return;
		setFocus({
			...focus,
			pomodoro: {
				startedAt: Date.now(),
				duration: data.settings.workMs,
				type: "work",
				completedPomodoros: 0,
				paused: false,
			},
		});
	}

	function pomoPause() {
		if (!focus?.pomodoro || focus.pomodoro.paused) return;
		setFocus({
			...focus,
			pomodoro: {
				...focus.pomodoro,
				paused: true,
				pausedRemaining: Math.max(
					0,
					focus.pomodoro.startedAt +
						focus.pomodoro.duration -
						Date.now(),
				),
			},
		});
	}

	function pomoResume() {
		if (!focus?.pomodoro || !focus.pomodoro.paused) return;
		const rem = focus.pomodoro.pausedRemaining ?? 0;
		setFocus({
			...focus,
			pomodoro: {
				...focus.pomodoro,
				startedAt: Date.now(),
				duration: rem,
				paused: false,
				pausedRemaining: undefined,
			},
		});
	}

	function pomoReset() {
		if (!focus?.pomodoro) return;
		const duration =
			focus.pomodoro.type === "work"
				? data.settings.workMs
				: focus.pomodoro.type === "short-break"
					? data.settings.shortBreakMs
					: data.settings.longBreakMs;
		setFocus({
			...focus,
			pomodoro: {
				...focus.pomodoro,
				startedAt: Date.now(),
				duration,
				paused: false,
				pausedRemaining: undefined,
			},
		});
	}

	function pomoStartBreak() {
		if (!focus?.pomodoro) return;
		const completed =
			focus.pomodoro.type === "work"
				? focus.pomodoro.completedPomodoros + 1
				: focus.pomodoro.completedPomodoros;
		const next = nextInterval(completed, data.settings);
		logPomodoroToServer();
		setFocus({
			...focus,
			pomodoro: {
				...focus.pomodoro,
				startedAt: Date.now(),
				duration: next.duration,
				type: next.type,
				completedPomodoros: completed,
				paused: false,
				pausedRemaining: undefined,
			},
		});
	}

	function pomoStartWork() {
		if (!focus?.pomodoro) return;
		setFocus({
			...focus,
			pomodoro: {
				...focus.pomodoro,
				startedAt: Date.now(),
				duration: data.settings.workMs,
				type: "work",
				paused: false,
				pausedRemaining: undefined,
			},
		});
	}

	function pomoStop() {
		if (!focus?.pomodoro) return;
		setFocus({
			...focus,
			pomodoro: {
				...focus.pomodoro,
				paused: true,
				pausedRemaining: 0,
			},
		});
	}

	function pomoDismiss() {
		if (!focus) return;
		setFocus({
			...focus,
			pomodoro: undefined,
		});
	}

	function logPomodoroToServer() {
		if (!focus?.pomodoro) return;
		logFormEl?.requestSubmit();
	}

	let detailTaskId = $state<string | null>(null);
	let detailVisible = $state(false);
	let detailOpen = $derived(detailTaskId !== null && detailVisible);

	let detailTodo = $derived(
		detailTaskId
			? ([...data.todos, ...data.archivedTodos].find(
					(t) => t.id === detailTaskId,
				) ?? null)
			: null,
	);

	let editingTaskId = $state<string | null>(null);
	let editingTodo = $derived(
		editingTaskId
			? (data.todos.find((t) => t.id === editingTaskId) ?? null)
			: null,
	);

	let collapsedGroups: Set<string> = $state(new Set());

	function toggleGroup(name: string) {
		if (collapsedGroups.has(name)) {
			collapsedGroups.delete(name);
		} else {
			collapsedGroups.add(name);
		}
		collapsedGroups = new Set(collapsedGroups);
	}

	let createExpanded = $state(false);
	let showCreateExtras = $derived(!focus || !!editingTodo || createExpanded);

	$effect(() => {
		if (focus) createExpanded = false;
	});

	function openEditForm(todoId: string) {
		const todo = data.todos.find((t) => t.id === todoId);
		if (todo) {
			editingTaskId = todoId;
			editDetail = todo.detail ?? "";
			editDeadlineChoice = todo.deadline ? "custom" : "none";
			editCustomDeadline = todo.deadline
				? new Date(todo.deadline - timezoneOffset * 60_000)
						.toISOString()
						.slice(0, 16)
				: "";
		}
	}

	function closeEditForm() {
		editingTaskId = null;
	}

	function hasUnsavedEdits(todoId: string): boolean {
		const todo = data.todos.find((t) => t.id === todoId);
		if (!todo) return false;
		if (editDetail !== (todo.detail ?? "")) return true;
		const origChoice = todo.deadline ? "custom" : "none";
		if (editDeadlineChoice !== origChoice) return true;
		return false;
	}

	function toggleEditForm(todoId: string) {
		if (editingTaskId === todoId) {
			if (!hasUnsavedEdits(todoId)) {
				editingTaskId = null;
			}
			// If unsaved data exists, do nothing (keep form open)
			return;
		}
		openEditForm(todoId);
		tick().then(() => {
			const section = document.querySelector('.create-section');
			if (section) {
				section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
				section.classList.add('edit-highlight');
				setTimeout(() => section.classList.remove('edit-highlight'), 600);
			}
		});
	}

	function openDetail(todoId: string) {
		detailTaskId = todoId;
		detailVisible = true;
	}

	function closeDetail() {
		detailVisible = false;
	}

	function toggleDetail() {
		if (detailOpen) {
			detailVisible = false;
		} else if (detailTaskId) {
			detailVisible = true;
		}
	}

	$effect(() => {
		if (
			detailTaskId &&
			![...data.todos, ...data.archivedTodos].some(
				(t) => t.id === detailTaskId,
			)
		) {
			detailTaskId = null;
		}
	});

	$effect(() => {
		if (editingTaskId && !data.todos.some((t) => t.id === editingTaskId)) {
			editingTaskId = null;
		}
	});

	function renderMarkdown(text: string): string {
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
			.replace(/\*(.+?)\*/g, "<em>$1</em>")
			.replace(/`(.+?)`/g, "<code>$1</code>")
			.replace(/~~(.+?)~~/g, "<del>$1</del>")
			.replace(
				/\[(.+?)\]\((.+?)\)/g,
				'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
			)
			.replace(/^- (.+)$/gm, "<li>$1</li>")
			.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
			.replace(/\n/g, "<br>");
	}

	function relativeTime(timestamp: number): string {
		const diff = Date.now() - timestamp;
		const mins = Math.floor(diff / 60_000);
		if (mins < 1) return "just now";
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	function getTaskPomodoros(taskId: string): PomodoroLog[] {
		return data.pomodoroLogs.filter(
			(l: PomodoroLog) => l.taskId === taskId && l.type === "work",
		);
	}

	function formatDuration(ms: number): string {
		const totalMin = Math.round(ms / 60_000);
		if (totalMin < 60) return `${totalMin}m`;
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	function pomodoroSummary(taskId: string): string | null {
		const logs = getTaskPomodoros(taskId);
		if (logs.length === 0) return null;
		const total = logs.reduce((sum, l) => sum + l.duration, 0);
		return `${logs.length} pomo${logs.length !== 1 ? "s" : ""} · ${formatDuration(total)}`;
	}

	function getTaskSessions(taskId: string): FocusSession[] {
		return data.sessions.filter(
			(s: FocusSession) => s.taskId === taskId && s.endedAt,
		);
	}

	function sessionDuration(session: FocusSession): number {
		if (!session.endedAt) return 0;
		return session.endedAt - session.startedAt;
	}

	const sessionLabels: Record<string, string> = { done: 'focused', switch: 'switch', manual: 'idle' };

	function formatSessionDate(timestamp: number): string {
		const d = new Date(timestamp);
		const now = new Date();
		const isToday = d.toDateString() === now.toDateString();
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 1);
		const isYesterday = d.toDateString() === yesterday.toDateString();
		if (isToday) return "Today";
		if (isYesterday) return "Yesterday";
		const months = [
			"Jan",
			"Feb",
			"Mar",
			"Apr",
			"May",
			"Jun",
			"Jul",
			"Aug",
			"Sep",
			"Oct",
			"Nov",
			"Dec",
		];
		return `${months[d.getMonth()]} ${d.getDate()}`;
	}

	function getProjectName(projectId: string): string {
		return (
			data.projects.find((p: { id: string }) => p.id === projectId)
				?.name ??
			data.archivedProjects.find(
				(p: { id: string }) => p.id === projectId,
			)?.name ??
			"Inbox"
		);
	}

	let focusedLastLog = $derived(
		focusedTodo?.logs?.length
			? focusedTodo.logs[focusedTodo.logs.length - 1]
			: null,
	);

	let focusedLastSession = $derived(
		focusedTodo
			? getTaskSessions(focusedTodo.id).at(-1) ?? null
			: null,
	);

	let todoGroups = $derived(() => {
		const groups: { name: string; todos: typeof data.todos }[] = [];
		const map = new Map<string, typeof data.todos>();
		for (const todo of data.todos) {
			const key = todo.projectId ?? '';
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(todo);
		}
		// Sort: incomplete tasks first, preserving order within each bucket
		const sortTodos = (todos: typeof data.todos) =>
			todos.slice().sort((a, b) => Number(a.done) - Number(b.done));
		// "INBOX" (no project) first, then named projects
		const inbox = map.get('');
		if (inbox) groups.push({ name: 'INBOX', todos: sortTodos(inbox) });
		for (const [key, todos] of map) {
			if (key !== '') groups.push({ name: getProjectName(key).toUpperCase(), todos: sortTodos(todos) });
		}
		return groups;
	});

	let activeTasks = $derived(
		data.todos.filter((t: { done: boolean }) => !t.done),
	);
	let focusedIndex = $derived(
		focus
			? activeTasks.findIndex(
					(t: { id: string }) => t.id === focus!.activeTaskId,
				)
			: -1,
	);
	let prevTask = $derived(
		focusedIndex > 0 ? activeTasks[focusedIndex - 1] : null,
	);
	let nextTask = $derived(
		focusedIndex >= 0 && focusedIndex < activeTasks.length - 1
			? activeTasks[focusedIndex + 1]
			: null,
	);

	function focusPrev() {
		if (prevTask) focusOnTask(prevTask.id);
	}

	function focusNext() {
		if (nextTask) focusOnTask(nextTask.id);
	}
</script>

<form
	method="POST"
	action="?/logPomodoro"
	use:enhance={() => {
		return async ({ update }) => {
			await update({ reset: false, invalidateAll: false });
		};
	}}
	bind:this={logFormEl}
	hidden
>
	<input type="hidden" name="taskId" value={focus?.activeTaskId ?? ""} />
	<input type="hidden" name="type" value={focus?.pomodoro?.type ?? ""} />
	<input
		type="hidden"
		name="duration"
		value={String(focus?.pomodoro?.duration ?? 0)}
	/>
</form>

<form
	method="POST"
	action="?/syncFocus"
	use:enhance={() => {
		return async ({ update }) => {
			await update({ reset: false, invalidateAll: false });
		};
	}}
	bind:this={syncFocusFormEl}
	hidden
>
	<input type="hidden" name="focus" value={focusJson} />
</form>

<form
	method="POST"
	action="?/focusTask"
	use:enhance={() => {
		return async ({ update }) => {
			await update({ reset: false, invalidateAll: false });
		};
	}}
	bind:this={focusFormEl}
	hidden
>
	<input type="hidden" name="taskId" value={focus?.activeTaskId ?? ""} />
</form>

<form
	method="POST"
	action="?/unfocus"
	use:enhance={() => {
		return async ({ update }) => {
			await update({ reset: false, invalidateAll: false });
		};
	}}
	bind:this={unfocusFormEl}
	hidden
></form>

<div class="home-layout" class:detail-open={detailOpen}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="detail-overlay"
		class:visible={detailOpen}
		onclick={closeDetail}
		onkeydown={(e) => {
			if (e.key === "Escape") closeDetail();
		}}
	></div>

	<main class="main-content">
			<header class="main-header home-header">
				<span class="tagline">Todo in your focus</span>
				{#if detailTaskId || focus?.activeTaskId}
					<button
						type="button"
						class="toggle-detail-btn"
						class:open={detailOpen}
						onclick={() => {
							const taskId = detailTaskId ?? focus?.activeTaskId ?? null;
							if (taskId) {
								if (detailTaskId === taskId && detailVisible) {
									detailVisible = false;
								} else {
									detailTaskId = taskId;
									detailVisible = true;
								}
							}
						}}
						aria-label={detailOpen ? "Hide history panel" : "Show history panel"}
						aria-expanded={detailOpen}
						title={detailOpen ? "Hide history" : "Show history"}
					>
						<span class="toggle-detail-btn-icon" aria-hidden="true"></span>
					</button>
				{/if}
			</header>

		{#if focus && focusedTodo}
			<section class="hero-focus">
				<div class="focus-top-bar">
					<span class="focus-project"
						>{focusedTodo.projectId
							? getProjectName(focusedTodo.projectId).toUpperCase()
							: "INBOX"}</span
					>
				</div>

				<div class="focus-title-row">
					<form
						method="POST"
						action="?/toggle"
						class="toggle-form"
						use:enhance
					>
						<input type="hidden" name="id" value={focusedTodo.id} />
						<button
							type="submit"
							class="hero-toggle-btn"
							aria-label="Mark task done"
						></button>
					</form>
					{#if prevTask}
						<button
							class="focus-nav-btn"
							onclick={focusPrev}
							aria-label="Previous task"
							title={prevTask.title}>&larr;</button
						>
					{/if}
					<h2 class="focus-title">{focusedTodo.title}</h2>
					{#if nextTask}
						<button
							class="focus-nav-btn"
							onclick={focusNext}
							aria-label="Next task"
							title={nextTask.title}>&rarr;</button
						>
					{/if}
					<button
						class="hero-edit-icon"
						class:active={editingTaskId === focusedTodo.id}
						onclick={() => toggleEditForm(focusedTodo.id)}
						aria-label={editingTaskId === focusedTodo.id ? "Close editor" : "Edit task"}
						title={editingTaskId === focusedTodo.id ? "Close editor" : "Edit task"}
					>{editingTaskId === focusedTodo.id ? '✕' : '✎'}</button>
					<button
						class="hero-pause-icon"
						class:paused={focus?.sessionPaused}
						onclick={() => focus?.sessionPaused ? resumeSession() : pauseSession()}
						aria-label={focus?.sessionPaused ? "Resume session" : "Pause session"}
						title={focus?.sessionPaused ? "Resume session" : "Pause session"}
					>{focus?.sessionPaused ? '▶' : '⏸'}</button>
					<button
						class="hero-stop-icon"
						onclick={unfocusTask}
						aria-label="Stop session"
						title="Stop session"
					>■</button>
				</div>

				{#if focusedTodo.detail}
					<p class="focus-detail">{focusedTodo.detail}</p>
				{/if}

				{#if focusedLastLog || focusedLastSession}
					<div class="focus-history-row">
						{#if focusedLastLog}
							<div class="focus-history-line">
								<span class="focus-log-label">LOG</span>
								<span class="focus-log-time">{relativeTime(focusedLastLog.createdAt)}</span>
								<span class="focus-log-text">{focusedLastLog.text}</span>
							</div>
						{/if}
						{#if focusedLastSession}
							<div class="focus-history-line">
								<span class="focus-log-label">SESSION</span>
								<span class="focus-log-time">{formatSessionDate(focusedLastSession.startedAt)}</span>
								<span class="focus-log-text">{formatDuration(sessionDuration(focusedLastSession))}</span>
							</div>
						{/if}
					</div>
					<button type="button" class="focus-view-logs" onclick={() => openDetail(focusedTodo.id)}>VIEW DETAILS &rsaquo;</button>
				{/if}

				<div class="focus-bottom">
					<div class="focus-session" class:paused={focus?.sessionPaused}>
						<span class="focus-session-label">{focus?.sessionPaused ? 'PAUSED' : 'SESSION'}</span>
						<span class="focus-elapsed"
							>{formatElapsed(sessionElapsed)}</span
						>
					</div>

					<div class="focus-pomodoro">
						{#if focus.pomodoro}
							<div class="pomo-pill" class:expired={pomoExpired}>
								{#if pomoExpired}
									<span class="pomo-label">TIME'S UP</span>
									{#if focus.pomodoro.type === "work"}
										<button
											class="pomo-action"
											onclick={pomoStartBreak}
											>BREAK</button
										>
									{:else}
										<button
											class="pomo-action"
											onclick={pomoStartWork}>WORK</button
										>
									{/if}
								{:else}
									<span class="pomo-time"
										>{formatTime(pomoRemaining)}</span
									>
									<span class="pomo-type">{pomoLabel}</span>
									{#if focus.pomodoro.paused}
										<button
											class="pomo-action"
											onclick={pomoResume}>GO</button
										>
									{:else}
										<button
											class="pomo-action"
											onclick={pomoPause}>PAUSE</button
										>
									{/if}
									<button
										class="pomo-action"
										onclick={pomoReset}>RESET</button
									>
								{/if}
								<button
									class="pomo-action pomo-stop"
									onclick={pomoStop}>STOP</button
								>
								<button
									class="pomo-dismiss"
									onclick={pomoDismiss}
									aria-label="Dismiss pomodoro"
									title="Dismiss pomodoro">✕</button
								>
								<div class="pomo-dots">
									{#each Array(4) as _, i}
										<span
											class="pomo-dot"
											class:filled={i < cyclesFilled}
										></span>
									{/each}
								</div>
							</div>
						{:else}
							<button
								class="pomo-start-btn"
								onclick={startPomodoro}>START POMODORO</button
							>
						{/if}
					</div>
				</div>

				<form
					class="focus-log-form"
					method="POST"
					action="?/addLog"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: true });
						};
					}}
				>
					<input type="hidden" name="id" value={focusedTodo.id} />
					<textarea
						name="text"
						rows="1"
						placeholder="What did you just do? (supports markdown)"
						required
						onkeydown={(e: KeyboardEvent) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								(e.target as HTMLTextAreaElement).form?.requestSubmit();
							}
						}}
					></textarea>
					<button type="submit">LOG</button>
				</form>
			</section>
		{/if}

		<section class="create-section" data-label={editingTodo ? `EDITING: ${editingTodo.title}` : "NEW TASK"}>
			{#if editingTodo}
				<form
					method="POST"
					action="?/update"
					class="create-form"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: false });
							closeEditForm();
						};
					}}
				>
					<input type="hidden" name="id" value={editingTodo.id} />
					<div class="create-top">
						<input
							type="text"
							value={editingTodo.title}
							disabled
						/>
						<button type="submit" class="btn-save">SAVE</button>
						<button type="button" class="btn-edit-close" onclick={closeEditForm}>✕</button>
					</div>
					<div class="create-extras">
						<textarea
							name="detail"
							placeholder="Details (optional)"
							rows="2"
							bind:value={editDetail}
						></textarea>
						<div class="deadline-row">
							<span class="deadline-label">DEADLINE:</span>
							<button
								type="button"
								class="deadline-opt"
								class:selected={editDeadlineChoice === "none"}
								onclick={() => (editDeadlineChoice = "none")}
								>NONE</button
							>
							<button
								type="button"
								class="deadline-opt"
								class:selected={editDeadlineChoice === "today"}
								onclick={() => (editDeadlineChoice = "today")}
								>TODAY</button
							>
							<button
								type="button"
								class="deadline-opt"
								class:selected={editDeadlineChoice === "tomorrow"}
								onclick={() => (editDeadlineChoice = "tomorrow")}
								>TOMORROW</button
							>
							<button
								type="button"
								class="deadline-opt"
								class:selected={editDeadlineChoice === "custom"}
								onclick={() => (editDeadlineChoice = "custom")}
								>CUSTOM</button
							>
							{#if editDeadlineChoice === "custom"}
								<input
									type="datetime-local"
									class="deadline-datetime"
									bind:value={editCustomDeadline}
								/>
							{/if}
						</div>
						<input
							type="hidden"
							name="deadline"
							value={editDeadlineValue}
						/>
						<input
							type="hidden"
							name="timezoneOffset"
							value={String(timezoneOffset)}
						/>
					</div>
				</form>
				<div class="create-extras edit-project-row">
					<div class="project-row">
						<span class="project-label">PROJECT:</span>
						<form
							class="project-inline-form"
							method="POST"
							action="?/setTaskProject"
							use:enhance={() => {
								return async ({ update }) => {
									await update({ reset: false });
								};
							}}
						>
							<input type="hidden" name="todoId" value={editingTodo.id} />
							<select name="projectId" class="project-select">
								<option value="" selected={!editingTodo.projectId}
									>INBOX</option
								>
								{#each data.projects as p (p.id)}
									<option
										value={p.id}
										selected={editingTodo.projectId === p.id}
										>{p.name.toUpperCase()}</option
									>
								{/each}
							</select>
							<button type="submit">SET</button>
						</form>
					</div>
				</div>
			{:else}
				<form
					method="POST"
					action="?/create"
					class="create-form"
					use:enhance={() => {
						return async ({ update }) => {
							await update();
							deadlineChoice = "none";
							customDeadline = "";
							createProjectId = "";
						};
					}}
				>
					<div class="create-top">
						<input
							type="text"
							name="title"
							placeholder="What needs to be done?"
							autocomplete="off"
							required
							onfocus={() => createExpanded = true}
						/>
						<button type="submit">ADD</button>
						{#if focus && !showCreateExtras}
							<button type="button" class="create-expand-btn" onclick={() => createExpanded = true} aria-label="Show more options" title="More options">&#9660;</button>
						{/if}
					</div>
					{#if showCreateExtras}
					<div class="create-extras">
						<textarea
							name="detail"
							placeholder="Details (optional)"
							rows="2"
						></textarea>
						<div class="deadline-row">
							<span class="deadline-label">DEADLINE:</span>
							<button
								type="button"
								class="deadline-opt"
								class:selected={deadlineChoice === "none"}
								onclick={() => (deadlineChoice = "none")}
								>NONE</button
							>
							<button
								type="button"
								class="deadline-opt"
								class:selected={deadlineChoice === "today"}
								onclick={() => (deadlineChoice = "today")}
								>TODAY</button
							>
							<button
								type="button"
								class="deadline-opt"
								class:selected={deadlineChoice === "tomorrow"}
								onclick={() => (deadlineChoice = "tomorrow")}
								>TOMORROW</button
							>
							<button
								type="button"
								class="deadline-opt"
								class:selected={deadlineChoice === "custom"}
								onclick={() => (deadlineChoice = "custom")}
								>CUSTOM</button
							>
							{#if deadlineChoice === "custom"}
								<input
									type="datetime-local"
									class="deadline-datetime"
									bind:value={customDeadline}
								/>
							{/if}
						</div>
						<div class="project-row">
							<span class="project-label">PROJECT:</span>
							<select
								class="project-select"
								name="projectId"
								bind:value={createProjectId}
							>
								<option value="">INBOX</option>
								{#each data.projects as p (p.id)}
									<option value={p.id}
										>{p.name.toUpperCase()}</option
									>
								{/each}
							</select>
						</div>
						<input
							type="hidden"
							name="deadline"
							value={createDeadlineValue}
						/>
						<input
							type="hidden"
							name="timezoneOffset"
							value={String(timezoneOffset)}
						/>
					</div>
					{/if}
				</form>
			{/if}
		</section>

		<section class="task-section" data-label="TASK QUEUE">
			{#if data.todos.length > 0}
				{#each todoGroups() as group (group.name)}
					<div class="task-group">
						<button
							class="task-group-header"
							onclick={() => toggleGroup(group.name)}
						>
							<span class="group-chevron" class:collapsed={collapsedGroups.has(group.name)}>▸</span>
							{group.name}
							<span class="group-count">{group.todos.length}</span>
						</button>
						{#if !collapsedGroups.has(group.name)}
						<ul class="todo-list">
							{#each group.todos as todo (todo.id)}
								{@const taskPomSummary = pomodoroSummary(todo.id)}
								{@const lastLog = todo.logs?.length
									? todo.logs[todo.logs.length - 1]
									: null}
								{@const totalFocus = todo.totalFocusMs ?? 0}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
							<li
									class="todo-item"
									class:done={todo.done}
									class:active={focus?.activeTaskId === todo.id}
									onclick={(e: MouseEvent) => {
										if ((e.target as HTMLElement)?.closest?.('button, a, select, form')) return;
										openDetail(todo.id);
									}}
								>
									<div class="todo-row">
										<form
											method="POST"
											action="?/toggle"
											class="toggle-form"
											use:enhance
										>
											<input
												type="hidden"
												name="id"
												value={todo.id}
											/>
											<button
												type="submit"
												class="toggle-btn"
												class:checked={todo.done}
											>
												{todo.done ? "✓" : ""}
											</button>
										</form>

										{#if todo.deadline && !todo.done && isOverdue(todo.deadline)}
											<span class="status-tag urgent"
												>(OVERDUE)</span
											>
										{:else if focus?.activeTaskId === todo.id}
											<span class="status-tag active"
												>[FOCUSED]</span
											>
										{/if}

										<button
											class="todo-title"
											onclick={() => {
												if (!todo.done) {
													if (focus?.activeTaskId === todo.id) {
														scrollFocusedHeroIntoView();
														openDetail(todo.id);
													} else {
														closeDetail();
														focusOnTask(todo.id);
													}
													return;
												}
												openDetail(todo.id);
											}}>{todo.title}</button
										>

										{#if todo.deadline}
											<span
												class="deadline-badge"
												class:overdue={!todo.done &&
													isOverdue(todo.deadline)}
											>
												{formatDeadline(todo.deadline)}
											</span>
										{/if}

										<div class="todo-actions">
											{#if !todo.done}
												<button
													class="btn-edit"
													onclick={() => toggleEditForm(todo.id)}
													>{editingTaskId === todo.id ? 'CLOSE' : 'EDIT'}</button
												>
											{/if}
											{#if !todo.done && focus?.activeTaskId === todo.id}
												<button onclick={() => unfocusTask()}
													>PAUSE</button
												>
											{/if}
											{#if todo.done}
												<form
													method="POST"
													action="?/archive"
													use:enhance
												>
													<input
														type="hidden"
														name="id"
														value={todo.id}
													/>
													<button type="submit"
														>ARCHIVE</button
													>
												</form>
											{/if}
											<form
												method="POST"
												action="?/delete"
												use:enhance
											>
												<input
													type="hidden"
													name="id"
													value={todo.id}
												/>
												<button
													type="submit"
													class="btn-danger"
													onclick={() => {
														if (
															focus?.activeTaskId ===
															todo.id
														)
															unfocusTask();
													}}>DEL</button
												>
											</form>
										</div>
									</div>

									{#if taskPomSummary || lastLog || totalFocus > 0}
										<div class="task-meta">
											{#if totalFocus > 0}
												<span class="task-meta-item"
													>{formatDuration(totalFocus)} focused</span
												>
											{/if}
											{#if taskPomSummary}
												<span class="task-meta-item"
													>{taskPomSummary}</span
												>
											{/if}
											{#if lastLog}
												<span class="task-meta-item"
													>{lastLog.text.slice(0, 40)}{lastLog
														.text.length > 40
														? "..."
														: ""} · {relativeTime(
														lastLog.createdAt,
													)}</span
												>
											{/if}
										</div>
									{/if}
								</li>
							{/each}
						</ul>
						{/if}
					</div>
				{/each}
			{:else}
				<div class="empty">No tasks yet. Add one above.</div>
			{/if}
		</section>
	</main>

	{#if detailTodo}
		{@const detailPomodoros = getTaskPomodoros(detailTodo.id)}
		{@const detailSessions = getTaskSessions(detailTodo.id)}
		<aside class="detail-panel" class:open={detailOpen}>
			<div class="detail-header">
				<div class="detail-header-info">
					<div class="detail-title">{detailTodo.title}</div>
					<div class="detail-badges">
						{#if detailTodo.done}
							<span class="detail-badge done">DONE</span>
						{:else if focus?.activeTaskId === detailTodo.id}
							<span class="detail-badge active">FOCUSED</span>
						{/if}
						{#if detailTodo.deadline && !detailTodo.done && isOverdue(detailTodo.deadline)}
							<span class="detail-badge overdue">OVERDUE</span>
						{/if}
					</div>
				</div>
				<button class="detail-close" onclick={closeDetail}>✕</button>
			</div>

			{#if detailTodo.detail}
				<div class="detail-section">
					<div class="detail-section-title">DETAILS</div>
					<p class="detail-text-readonly">{detailTodo.detail}</p>
				</div>
			{/if}

			{#if detailSessions.length > 0 || (detailTodo.totalFocusMs ?? 0) > 0}
				<div class="detail-section">
					<div class="detail-section-title">SESSIONS</div>
					<div class="session-summary">
						<strong
							>{formatDuration(
								detailTodo.totalFocusMs ?? 0,
							)}</strong
						>
						across {detailSessions.length} session{detailSessions.length !==
						1
							? "s"
							: ""}
					</div>
					{#if detailSessions.length > 0}
						<div class="session-list">
							{#each detailSessions
								.slice(-5)
								.reverse() as session (session.id)}
								<div class="session-entry">
									<span class="session-date"
										>{formatSessionDate(
											session.startedAt,
										)}</span
									>
									<span class="session-duration"
										>{formatDuration(
											sessionDuration(session),
										)}</span
									>
									<span class="session-reason"
										>{sessionLabels[session.endReason ?? ''] ?? session.endReason ?? ""}</span
									>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			{#if detailPomodoros.length > 0}
				<div class="detail-section">
					<div class="detail-section-title">POMODOROS</div>
					<div class="time-summary">
						<strong
							>{detailPomodoros.length} session{detailPomodoros.length !==
							1
								? "s"
								: ""}</strong
						>
						· {formatDuration(
							detailPomodoros.reduce((s, l) => s + l.duration, 0),
						)} total
					</div>
				</div>
			{/if}

			{#if detailTodo.logs && detailTodo.logs.length > 0}
				<div class="detail-section">
					<div class="detail-section-title">ACTIVITY LOG</div>
					<div class="log-list">
						{#each [...detailTodo.logs].reverse() as log (log.id)}
							<div class="log-entry">
								<div class="log-entry-header">
									<span class="log-time"
										>{relativeTime(log.createdAt)}</span
									>
									<form
										method="POST"
										action="?/deleteLog"
										use:enhance
									>
										<input
											type="hidden"
											name="id"
											value={detailTodo.id}
										/>
										<input
											type="hidden"
											name="logId"
											value={log.id}
										/>
										<button type="submit" class="log-delete"
											>✕</button
										>
									</form>
								</div>
								<div class="log-text">
									{@html renderMarkdown(log.text)}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</aside>
	{/if}
</div>
