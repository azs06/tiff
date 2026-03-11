<script lang="ts">
	import { enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";
	import { tick } from "svelte";
	import type { PageData } from "./$types";
	import type { PomodoroLog, FocusSession } from "$lib/types";
	import {
		focusTaskIds,
		getDisplayTimer,
		getExpandedFocusedTask,
		getFocusedTask,
		getPomodoroRemaining,
		getSessionElapsed,
		hasExpiredPomodoro,
		normalizeFocusState,
	} from "$lib/focus";

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

	const DETAIL_HISTORY_KEY = "tiffTaskCallout";
	const FOCUS_ACCORDION_DEFAULT = new Set(["recent"]);

	function parseTaskHash(hash: string): string | null {
		const match = /^#task\/(.+)$/.exec(hash);
		return match ? decodeURIComponent(match[1]) : null;
	}

	function serializeTaskHash(taskId: string): string {
		return `#task/${encodeURIComponent(taskId)}`;
	}

	function getPageUrl(hash = ""): string {
		return `${window.location.pathname}${window.location.search}${hash}`;
	}

	let now = $state(Date.now());

	$effect(() => {
		const id = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(id);
	});

	let focus = $derived(normalizeFocusState(data.serverFocus));
	let visibleFocus = $derived(
		normalizeFocusState({
			expandedTaskId: focus?.expandedTaskId ?? null,
			tasks: (focus?.tasks ?? []).filter((task) =>
				data.todos.some((todo) => todo.id === task.taskId),
			),
		}),
	);
	let focusedTaskIdSet = $derived(focusTaskIds(visibleFocus));
	let expandedFocusedTask = $derived(
		visibleFocus ? getExpandedFocusedTask(visibleFocus) : null,
	);
	let collapsedFocusedTasks = $derived(
		visibleFocus?.tasks.filter((task) => task.taskId !== expandedFocusedTask?.taskId) ?? [],
	);
	let focusedTodo = $derived(
		expandedFocusedTask
			? data.todos.find((todo) => todo.id === expandedFocusedTask.taskId) ?? null
			: null,
	);

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

	let pomoLabel = $derived(
		expandedFocusedTask?.pomodoro
			? expandedFocusedTask.pomodoro.type === "work"
				? "WORK"
				: expandedFocusedTask.pomodoro.type === "short-break"
					? "SHORT BREAK"
					: "LONG BREAK"
			: "",
	);

	let cyclesFilled = $derived(
		expandedFocusedTask?.pomodoro
			? expandedFocusedTask.pomodoro.completedPomodoros % 4
			: 0,
	);

	let sessionElapsed = $derived(
		expandedFocusedTask ? getSessionElapsed(expandedFocusedTask, now) : 0,
	);
	let pomoRemaining = $derived(
		expandedFocusedTask ? getPomodoroRemaining(expandedFocusedTask, now) : 0,
	);
	let pomoExpired = $derived(
		expandedFocusedTask ? hasExpiredPomodoro(expandedFocusedTask, now) : false,
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

	async function postAction(action: string, values: Record<string, string>) {
		const formData = new FormData();
		for (const [key, value] of Object.entries(values)) {
			formData.set(key, value);
		}
		const response = await fetch(`?/${action}`, {
			method: "POST",
			body: formData,
			headers: {
				"x-sveltekit-action": "true",
			},
		});
		if (!response.ok) {
			throw new Error(`Focus action failed: ${action}`);
		}
		await invalidateAll();
	}

	async function focusOnTask(taskId: string) {
		await postAction("focusTask", { taskId });
		await tick();
		scrollFocusedHeroIntoView();
	}

	async function expandTask(taskId: string) {
		await postAction("expandFocusTask", { taskId });
		await tick();
		scrollFocusedHeroIntoView();
	}

	async function toggleTaskRunState(taskId: string) {
		const task = getFocusedTask(visibleFocus, taskId);
		if (!task) return;
		await postAction(
			task.sessionStatus === "running" ? "pauseFocusTask" : "resumeFocusTask",
			{ taskId },
		);
	}

	async function stopTask(taskId: string) {
		await postAction("stopFocusTask", { taskId });
	}

	async function startPomodoro(taskId: string) {
		await postAction("startTaskPomodoro", { taskId });
	}

	async function pomoPause(taskId: string) {
		await postAction("pauseTaskPomodoro", { taskId });
	}

	async function pomoResume(taskId: string) {
		await postAction("resumeTaskPomodoro", { taskId });
	}

	async function pomoReset(taskId: string) {
		await postAction("resetTaskPomodoro", { taskId });
	}

	async function pomoAdvance(taskId: string) {
		await postAction("advanceTaskPomodoro", { taskId });
	}

	async function pomoStop(taskId: string) {
		await postAction("stopTaskPomodoro", { taskId });
	}

	async function pomoDismiss(taskId: string) {
		await postAction("dismissTaskPomodoro", { taskId });
	}

	let detailTaskId = $state<string | null>(null);
	let detailOpenedFromSession = $state(false);
	let detailCloseButton = $state<HTMLButtonElement | null>(null);
	let lastDetailTrigger: HTMLElement | null = null;

	let detailTodo = $derived(
		detailTaskId
			? ([...data.todos, ...data.archivedTodos].find(
					(t) => t.id === detailTaskId,
				) ?? null)
			: null,
	);
	let detailOpen = $derived(detailTodo !== null);

	function hasKnownTask(taskId: string | null): taskId is string {
		return !!taskId && [...data.todos, ...data.archivedTodos].some((t) => t.id === taskId);
	}

	function syncDetailFromHash(options?: { restoreFocusOnClose?: boolean }) {
		const restoreFocusOnClose = options?.restoreFocusOnClose ?? false;
		const previousTaskId = detailTaskId;
		const nextTaskId = parseTaskHash(window.location.hash);
		detailTaskId = hasKnownTask(nextTaskId) ? nextTaskId : null;
		detailOpenedFromSession = Boolean(window.history.state?.[DETAIL_HISTORY_KEY]);
		if (restoreFocusOnClose && previousTaskId && !detailTaskId) {
			restoreDetailTriggerFocus();
		}
	}

	function rememberDetailTrigger(trigger?: EventTarget | null) {
		if (trigger instanceof HTMLElement) {
			lastDetailTrigger = trigger;
		}
	}

	function restoreDetailTriggerFocus() {
		const nextFocusTarget = lastDetailTrigger;
		lastDetailTrigger = null;
		if (!nextFocusTarget) return;
		tick().then(() => {
			nextFocusTarget.focus();
		});
	}

	function openDetail(todoId: string, trigger?: EventTarget | null) {
		if (!hasKnownTask(todoId)) return;
		rememberDetailTrigger(trigger);
		const nextHash = serializeTaskHash(todoId);
		if (window.location.hash === nextHash && detailTaskId === todoId) return;
		const nextState = { ...(window.history.state ?? {}), [DETAIL_HISTORY_KEY]: true };
		if (detailOpen) {
			window.history.replaceState(nextState, "", getPageUrl(nextHash));
		} else {
			window.history.pushState(nextState, "", getPageUrl(nextHash));
		}
		detailTaskId = todoId;
		detailOpenedFromSession = true;
	}

	function closeDetail(options?: { restoreFocus?: boolean }) {
		if (!detailOpen) return;
		const restoreFocus = options?.restoreFocus ?? true;
		if (restoreFocus) restoreDetailTriggerFocus();
		if (detailOpenedFromSession && window.history.state?.[DETAIL_HISTORY_KEY]) {
			window.history.back();
			return;
		}
		const nextState = { ...(window.history.state ?? {}) };
		delete nextState[DETAIL_HISTORY_KEY];
		window.history.replaceState(nextState, "", getPageUrl());
		syncDetailFromHash();
	}

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
	let showCreateExtras = $derived(!visibleFocus || !!editingTodo || createExpanded);

	$effect(() => {
		if (visibleFocus) createExpanded = false;
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

	$effect(() => {
		if (!detailTaskId) return;
		if (hasKnownTask(detailTaskId)) return;
		closeDetail({ restoreFocus: false });
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

	const sessionLabels: Record<string, string> = { done: 'focused', switch: 'switch', manual: 'idle', pause: 'paused' };

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
	let focusedSessions = $derived(
		focusedTodo ? getTaskSessions(focusedTodo.id) : [],
	);
	let focusedPomodoros = $derived(
		focusedTodo ? getTaskPomodoros(focusedTodo.id) : [],
	);
	let focusedLogCount = $derived(focusedTodo?.logs?.length ?? 0);
	let focusAccordionTaskId = $state<string | null>(null);
	let openFocusAccordions = $state(new Set<string>());

	$effect(() => {
		const nextTaskId = focusedTodo?.id ?? null;
		if (focusAccordionTaskId === nextTaskId) return;
		focusAccordionTaskId = nextTaskId;
		openFocusAccordions = nextTaskId ? new Set(FOCUS_ACCORDION_DEFAULT) : new Set();
	});

	function toggleFocusAccordion(section: string) {
		const next = new Set(openFocusAccordions);
		if (next.has(section)) {
			next.delete(section);
		} else {
			next.add(section);
		}
		openFocusAccordions = next;
	}

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

	$effect(() => {
		syncDetailFromHash();
		const onHashChange = () => syncDetailFromHash({ restoreFocusOnClose: true });
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	});

	$effect(() => {
		if (!detailOpen) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		tick().then(() => detailCloseButton?.focus());
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			closeDetail();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", onKeyDown);
		};
	});
</script>

<div class="home-layout" class:detail-open={detailOpen}>
	<main class="main-content">
			<header class="main-header home-header">
				<span class="tagline">Todo in your focus</span>
			</header>

		{#if collapsedFocusedTasks.length > 0}
			<section class="focus-stack" aria-label="Focused task stack">
				{#each collapsedFocusedTasks as task (task.taskId)}
					{@const taskTodo = data.todos.find((todo) => todo.id === task.taskId)}
					{#if taskTodo}
						<div class="focus-stack-row">
							<button
								type="button"
								class="focus-stack-summary"
								onclick={() => expandTask(task.taskId)}
								aria-label={`Expand ${taskTodo.title}`}
							>
								<span class="focus-stack-timer">
									{task.pomodoro
										? formatTime(getDisplayTimer(task, now))
										: formatElapsed(getDisplayTimer(task, now))}
								</span>
								<span class="focus-stack-title">{taskTodo.title}</span>
							</button>
							<div class="focus-stack-actions">
								<button
									type="button"
									class="focus-stack-action"
									onclick={() => toggleTaskRunState(task.taskId)}
									aria-label={task.sessionStatus === "running" ? "Pause task" : "Resume task"}
								>{task.sessionStatus === "running" ? "⏸" : "▶"}</button>
								<button
									type="button"
									class="focus-stack-action focus-stack-stop"
									onclick={() => stopTask(task.taskId)}
									aria-label="Stop task focus"
								>■</button>
							</div>
						</div>
					{/if}
				{/each}
			</section>
		{/if}

		{#if expandedFocusedTask && focusedTodo}
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
					<h2 class="focus-title">{focusedTodo.title}</h2>
					<button
						class="hero-edit-icon"
						class:active={editingTaskId === focusedTodo.id}
						onclick={() => toggleEditForm(focusedTodo.id)}
						aria-label={editingTaskId === focusedTodo.id ? "Close editor" : "Edit task"}
						title={editingTaskId === focusedTodo.id ? "Close editor" : "Edit task"}
					>{editingTaskId === focusedTodo.id ? '✕' : '✎'}</button>
					<button
						class="hero-pause-icon"
						class:paused={expandedFocusedTask.sessionStatus === "paused"}
						onclick={() => toggleTaskRunState(expandedFocusedTask.taskId)}
						aria-label={expandedFocusedTask.sessionStatus === "paused" ? "Resume task" : "Pause task"}
						title={expandedFocusedTask.sessionStatus === "paused" ? "Resume task" : "Pause task"}
					>{expandedFocusedTask.sessionStatus === "paused" ? '▶' : '⏸'}</button>
					<button
						class="hero-stop-icon"
						onclick={() => stopTask(expandedFocusedTask.taskId)}
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
				{/if}

				<div class="focus-bottom">
					<div class="focus-session" class:paused={expandedFocusedTask.sessionStatus === "paused"}>
						<span class="focus-session-label">{expandedFocusedTask.sessionStatus === "paused" ? 'PAUSED' : 'SESSION'}</span>
						<span class="focus-elapsed"
							>{formatElapsed(sessionElapsed)}</span
						>
					</div>

					<div class="focus-pomodoro">
						{#if expandedFocusedTask.pomodoro}
							<div class="pomo-pill" class:expired={pomoExpired}>
								{#if pomoExpired}
									<span class="pomo-label">TIME'S UP</span>
									{#if expandedFocusedTask.pomodoro.type === "work"}
										<button
											class="pomo-action"
											onclick={() => pomoAdvance(expandedFocusedTask.taskId)}
											>BREAK</button
										>
									{:else}
										<button
											class="pomo-action"
											onclick={() => pomoAdvance(expandedFocusedTask.taskId)}>WORK</button
										>
									{/if}
								{:else}
									<span class="pomo-time"
										>{formatTime(pomoRemaining)}</span
									>
									<span class="pomo-type">{pomoLabel}</span>
									{#if expandedFocusedTask.pomodoro.paused}
										<button
											class="pomo-action"
											onclick={() => pomoResume(expandedFocusedTask.taskId)}>GO</button
										>
									{:else}
										<button
											class="pomo-action"
											onclick={() => pomoPause(expandedFocusedTask.taskId)}>PAUSE</button
										>
									{/if}
									<button
										class="pomo-action"
										onclick={() => pomoReset(expandedFocusedTask.taskId)}>RESET</button
									>
								{/if}
								<button
									class="pomo-action pomo-stop"
									onclick={() => pomoStop(expandedFocusedTask.taskId)}>STOP</button
								>
								<button
									class="pomo-dismiss"
									onclick={() => pomoDismiss(expandedFocusedTask.taskId)}
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
								onclick={() => startPomodoro(expandedFocusedTask.taskId)}>START POMODORO</button
							>
						{/if}
					</div>
				</div>

				<button
					type="button"
					class="focus-view-logs"
					onclick={(event) => openDetail(focusedTodo.id, event.currentTarget)}
				>OPEN TASK SHEET &rsaquo;</button>

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

				<div class="focus-inline-details" aria-label="Focused task quick details">
					<section class="focus-accordion" class:open={openFocusAccordions.has("recent")}>
						<button
							type="button"
							class="focus-accordion-toggle"
							onclick={() => toggleFocusAccordion("recent")}
							aria-expanded={openFocusAccordions.has("recent")}
						>
							<span class="focus-accordion-title">Recent activity</span>
							<span class="focus-accordion-summary">
								{#if focusedLastLog && focusedLastSession}
									log + session
								{:else if focusedLastLog}
									latest log
								{:else if focusedLastSession}
									latest session
								{:else}
									no recent activity
								{/if}
							</span>
						</button>
						{#if openFocusAccordions.has("recent")}
							<div class="focus-accordion-body">
								{#if focusedLastLog}
									<div class="focus-inline-row">
										<span class="focus-inline-label">LOG</span>
										<div class="focus-inline-copy">
											<div class="focus-inline-heading">{relativeTime(focusedLastLog.createdAt)}</div>
											<p>{focusedLastLog.text}</p>
										</div>
									</div>
								{/if}
								{#if focusedLastSession}
									<div class="focus-inline-row">
										<span class="focus-inline-label">SESSION</span>
										<div class="focus-inline-copy">
											<div class="focus-inline-heading">{formatSessionDate(focusedLastSession.startedAt)}</div>
											<p>{formatDuration(sessionDuration(focusedLastSession))} ended {sessionLabels[focusedLastSession.endReason ?? "manual"] ?? focusedLastSession.endReason ?? "manual"}</p>
										</div>
									</div>
								{/if}
								{#if !focusedLastLog && !focusedLastSession}
									<div class="focus-inline-empty">No completed sessions or logs yet for this task.</div>
								{/if}
							</div>
						{/if}
					</section>

					<section class="focus-accordion" class:open={openFocusAccordions.has("sessions")}>
						<button
							type="button"
							class="focus-accordion-toggle"
							onclick={() => toggleFocusAccordion("sessions")}
							aria-expanded={openFocusAccordions.has("sessions")}
						>
							<span class="focus-accordion-title">Session summary</span>
							<span class="focus-accordion-summary">{formatDuration(focusedTodo.totalFocusMs ?? 0)} across {focusedSessions.length} session{focusedSessions.length !== 1 ? "s" : ""}</span>
						</button>
						{#if openFocusAccordions.has("sessions")}
							<div class="focus-accordion-body">
								<div class="focus-stat-grid">
									<div class="focus-stat">
										<span class="focus-stat-label">Total</span>
										<strong>{formatDuration(focusedTodo.totalFocusMs ?? 0)}</strong>
									</div>
									<div class="focus-stat">
										<span class="focus-stat-label">Sessions</span>
										<strong>{focusedSessions.length}</strong>
									</div>
									<div class="focus-stat">
										<span class="focus-stat-label">Last end</span>
										<strong>{focusedLastSession ? formatSessionDate(focusedLastSession.startedAt) : "None"}</strong>
									</div>
									<div class="focus-stat">
										<span class="focus-stat-label">Pomodoros</span>
										<strong>{focusedPomodoros.length}</strong>
									</div>
								</div>
							</div>
						{/if}
					</section>

					<section class="focus-accordion" class:open={openFocusAccordions.has("notes")}>
						<button
							type="button"
							class="focus-accordion-toggle"
							onclick={() => toggleFocusAccordion("notes")}
							aria-expanded={openFocusAccordions.has("notes")}
						>
							<span class="focus-accordion-title">Notes</span>
							<span class="focus-accordion-summary">{focusedTodo.detail ? "1 note" : "no note"} · {focusedLogCount} log{focusedLogCount !== 1 ? "s" : ""}</span>
						</button>
						{#if openFocusAccordions.has("notes")}
							<div class="focus-accordion-body">
								{#if focusedTodo.detail}
									<p class="focus-inline-note">{focusedTodo.detail}</p>
								{:else}
									<div class="focus-inline-empty">No persistent notes on this task yet.</div>
								{/if}
								<div class="focus-inline-meta">
									<span>{focusedLogCount} log{focusedLogCount !== 1 ? "s" : ""}</span>
									<span>{focusedPomodoros.length} pomo{focusedPomodoros.length !== 1 ? "s" : ""}</span>
								</div>
							</div>
						{/if}
					</section>
				</div>
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
						{#if visibleFocus && !showCreateExtras}
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
									class:active={focusedTaskIdSet.has(todo.id)}
									tabindex="-1"
									onclick={(e: MouseEvent) => {
										if ((e.target as HTMLElement)?.closest?.('button, a, select, form')) return;
										openDetail(todo.id, e.currentTarget);
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
										{:else if focusedTaskIdSet.has(todo.id)}
											<span class="status-tag active"
												>[FOCUSED]</span
											>
										{/if}

										<button
											class="todo-title"
											onclick={async (event) => {
												if (!todo.done) {
													if (focusedTaskIdSet.has(todo.id)) {
														scrollFocusedHeroIntoView();
														await expandTask(todo.id);
													} else {
														closeDetail();
														await focusOnTask(todo.id);
													}
													return;
												}
												openDetail(todo.id, event.currentTarget);
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
											{#if !todo.done && focusedTaskIdSet.has(todo.id)}
												<button onclick={() => toggleTaskRunState(todo.id)}
													>{getFocusedTask(visibleFocus, todo.id)?.sessionStatus === "running" ? "PAUSE" : "PLAY"}</button
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
													class="btn-danger">DEL</button
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
		{@const detailHasDetail = Boolean(detailTodo.detail)}
		{@const detailHasSessions = detailSessions.length > 0 || (detailTodo.totalFocusMs ?? 0) > 0}
		{@const detailHasPomodoros = detailPomodoros.length > 0}
		{@const detailHasLogs = (detailTodo.logs?.length ?? 0) > 0}
		{@const detailHasContent = detailHasDetail || detailHasSessions || detailHasPomodoros || detailHasLogs}
		{@const detailSectionCount = Number(detailHasDetail) + Number(detailHasSessions) + Number(detailHasPomodoros) + Number(detailHasLogs)}
		{@const detailSparseState = detailHasContent && detailSectionCount <= 2}
		<div class="detail-overlay visible" aria-hidden="true" onclick={() => closeDetail({ restoreFocus: false })}></div>
		<div
			class="detail-panel"
			class:open={detailOpen}
			role="dialog"
			aria-modal="true"
			aria-labelledby="detail-title"
		>
			<div class="detail-header">
				<div class="detail-header-info">
					<div class="detail-title" id="detail-title">{detailTodo.title}</div>
					<div class="detail-badges">
						{#if detailTodo.done}
							<span class="detail-badge done">DONE</span>
						{:else if focusedTaskIdSet.has(detailTodo.id)}
							<span class="detail-badge active">FOCUSED</span>
						{/if}
						{#if detailTodo.deadline && !detailTodo.done && isOverdue(detailTodo.deadline)}
							<span class="detail-badge overdue">OVERDUE</span>
						{/if}
					</div>
				</div>
				<button bind:this={detailCloseButton} class="detail-close" onclick={() => closeDetail()}>✕</button>
			</div>

			{#if !detailHasContent}
				<div class="detail-empty">
					<div class="detail-empty-illustration" aria-hidden="true">
						<svg viewBox="0 0 220 220" class="coffee-cup-art">
							<defs>
								<linearGradient id="coffeeGlow" x1="0%" y1="0%" x2="0%" y2="100%">
									<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.9" />
									<stop offset="100%" stop-color="var(--accent-dark)" stop-opacity="0.45" />
								</linearGradient>
							</defs>
							<path class="coffee-steam coffee-steam--1" d="M86 72c-8-15 8-18 0-34" />
							<path class="coffee-steam coffee-steam--2" d="M110 64c-10-18 10-22 0-40" />
							<path class="coffee-steam coffee-steam--3" d="M136 72c-7-14 7-19 0-33" />
							<ellipse class="coffee-shadow" cx="110" cy="176" rx="54" ry="12" />
							<path class="coffee-saucer" d="M52 166h116" />
							<path class="coffee-cup" d="M66 98h88v44c0 17-13 30-30 30H96c-17 0-30-13-30-30z" />
							<path class="coffee-fill" d="M74 102h72v26H74z" />
							<path class="coffee-rim" d="M70 98h80" />
							<path class="coffee-handle" d="M154 112h10c12 0 20 9 20 20s-8 20-20 20h-10" />
						</svg>
					</div>
					<div class="detail-empty-copy">
						<div class="detail-section-title">Task sheet warming up</div>
						<p>No notes, sessions, pomodoros, or logs yet. Let this one simmer and come back once the work starts leaving a trail.</p>
					</div>
				</div>
			{/if}

			{#if detailHasDetail}
				<div class="detail-section">
					<div class="detail-section-title">DETAILS</div>
					<p class="detail-text-readonly">{detailTodo.detail}</p>
				</div>
			{/if}

			{#if detailHasSessions}
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

			{#if detailHasPomodoros}
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

			{#if detailHasLogs}
				<div class="detail-section">
					<div class="detail-section-title">ACTIVITY LOG</div>
					<div class="log-list">
						{#each [...(detailTodo.logs ?? [])].reverse() as log (log.id)}
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

			{#if detailSparseState}
				<div class="detail-sparse-state">
					<div class="detail-empty-illustration detail-empty-illustration--sparse" aria-hidden="true">
						<svg viewBox="0 0 320 220" class="task-sheet-art">
							<defs>
								<linearGradient id="taskSheetGlow" x1="0%" y1="0%" x2="100%" y2="100%">
									<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.9" />
									<stop offset="100%" stop-color="var(--accent-dark)" stop-opacity="0.25" />
								</linearGradient>
							</defs>
							<ellipse class="task-sheet-shadow" cx="168" cy="184" rx="98" ry="18" />
							<path class="task-sheet-gear-outer" d="M92 108l-10-6 6-10-7-12 9-8-2-12 12-2 3-12 12 2 8-10 10 6 10-6 8 10 12-2 3 12 12 2-2 12 9 8-7 12 6 10-10 6v12l-12 3-3 12-12-2-8 10-10-6-10 6-8-10-12 2-3-12-12-3z" />
							<circle class="task-sheet-gear-inner" cx="114" cy="96" r="25" />
							<circle class="task-sheet-gear-core" cx="114" cy="96" r="8" />
							<g class="task-sheet-page">
								<path class="task-sheet-panel" d="M146 44h94l32 30v100H146z" />
								<path class="task-sheet-fold" d="M240 44v30h32" />
								<rect class="task-sheet-tab" x="166" y="64" width="62" height="14" rx="3" />
								<path class="task-sheet-line" d="M166 98h86" />
								<path class="task-sheet-line" d="M166 120h86" />
								<path class="task-sheet-line" d="M166 142h64" />
								<path class="task-sheet-line task-sheet-line--accent" d="M166 164h50" />
							</g>
							<path class="task-sheet-link" d="M138 112c14 0 18 12 28 12" />
						</svg>
					</div>
					<div class="detail-empty-copy">
						<div class="detail-section-title">Task sheet in motion</div>
						<p>Some signals are already coming through. Keep adding notes, logs, or pomodoros and this sheet will fill out instead of idling on one section.</p>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
