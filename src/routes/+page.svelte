<script lang="ts">
	import { applyAction, enhance } from "$app/forms";
	import { afterNavigate, invalidateAll, pushState, replaceState } from "$app/navigation";
	import { page } from "$app/state";
	import { tick } from "svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import type { PageData } from "./$types";
	import type { FocusSession, FocusState } from "$lib/types";
	import {
		expandFocusedTask,
		focusTaskIds,
		getExpandedFocusedTask,
		getFocusedTask,
		getSessionElapsed,
		normalizeFocusState,
		stopFocusedTask,
		upsertFocusedTask,
	} from "$lib/focus";

	let { data }: { data: PageData } = $props();

	type TaskHistoryState = Record<string, unknown> & {
		taskViewTaskId?: string | null;
	};

	let timezoneOffset = $state(0);
	let deadlineChoice = $state<"none" | "today" | "tomorrow" | "custom">(
		"none",
	);
	let customDeadline = $state("");
	let createProjectId = $state("");
	let optimisticDoneById = $state<Record<string, boolean>>({});
	let pendingToggleById = $state<Record<string, boolean>>({});
	let taskUrlRoutingReady = $state(false);

	let editDetail = $state("");
	let editDeadlineChoice = $state<"none" | "today" | "tomorrow" | "custom">(
		"none",
	);
	let editCustomDeadline = $state("");

	$effect(() => {
		timezoneOffset = new Date().getTimezoneOffset();
	});

	afterNavigate(() => {
		taskUrlRoutingReady = true;
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

	function withoutToggleKey(source: Record<string, boolean>, id: string) {
		const next = { ...source };
		delete next[id];
		return next;
	}

	function setOptimisticDone(id: string, done: boolean | null) {
		if (done === null) {
			optimisticDoneById = withoutToggleKey(optimisticDoneById, id);
			return;
		}
		optimisticDoneById = { ...optimisticDoneById, [id]: done };
	}

	function setPendingToggle(id: string, pending: boolean) {
		if (!pending) {
			pendingToggleById = withoutToggleKey(pendingToggleById, id);
			return;
		}
		pendingToggleById = { ...pendingToggleById, [id]: true };
	}

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

	const FOCUS_ACCORDION_DEFAULT = new Set(["recent"]);

	let now = $state(Date.now());

	$effect(() => {
		const id = setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => clearInterval(id);
	});

	let serverFocus = $derived(normalizeFocusState(data.serverFocus));
	let optimisticFocus = $state<FocusState | null | undefined>(undefined);
	let focus = $derived(optimisticFocus === undefined ? serverFocus : optimisticFocus);
	let effectiveTodos = $derived(
		data.todos.map((todo) => {
			const optimisticDone = optimisticDoneById[todo.id];
			return optimisticDone === undefined ? todo : { ...todo, done: optimisticDone };
		}),
	);
	let effectiveTodoMap = $derived(
		new Map(effectiveTodos.map((todo) => [todo.id, todo])),
	);
	let activeTodoMap = $derived(
		new Map(
			effectiveTodos
				.filter((todo) => !todo.done)
				.map((todo) => [todo.id, todo]),
		),
	);
	let effectiveFocus = $derived(
		focus
			? normalizeFocusState({
					expandedTaskId: focus.expandedTaskId,
					tasks: focus.tasks.filter((task) => {
						const todo = effectiveTodoMap.get(task.taskId);
						return todo !== undefined && !todo.done;
					}),
				})
			: null,
	);
	let visibleFocus = $derived(
		normalizeFocusState({
			expandedTaskId: effectiveFocus?.expandedTaskId ?? null,
			tasks: (effectiveFocus?.tasks ?? []).filter((task) =>
				effectiveTodoMap.has(task.taskId),
			),
		}),
	);
	let focusedTaskIdSet = $derived(focusTaskIds(visibleFocus));
	let currentPageUrl = $derived(page.url);
	let taskHistoryState = $derived(
		((page.state as TaskHistoryState | null | undefined) ?? {}) as TaskHistoryState,
	);
	let requestedTaskId = $derived.by(() => {
		const historyTaskId = taskHistoryState.taskViewTaskId;
		if (historyTaskId !== undefined) return historyTaskId ?? null;
		return new URLSearchParams(currentPageUrl.search).get("task");
	});
	let expandedFocusedTask = $derived(
		visibleFocus ? getExpandedFocusedTask(visibleFocus) : null,
	);
	let heroTaskId = $derived(
		requestedTaskId && activeTodoMap.has(requestedTaskId)
			? requestedTaskId
			: expandedFocusedTask?.taskId ?? null,
	);
	let heroFocusTask = $derived(
		heroTaskId ? getFocusedTask(visibleFocus, heroTaskId) : null,
	);
	let collapsedFocusedTasks = $derived(
		visibleFocus?.tasks.filter((task) => task.taskId !== heroFocusTask?.taskId) ?? [],
	);
	let focusedTodo = $derived(
		heroTaskId
			? effectiveTodoMap.get(heroTaskId) ?? null
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

	let sessionElapsed = $derived(
		heroFocusTask ? getSessionElapsed(heroFocusTask, now) : 0,
	);

	function scrollFocusedHeroIntoView() {
		const hero = document.querySelector('.hero-focus');
		if (!(hero instanceof HTMLElement)) return;
		hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function getCurrentTaskUrl() {
		return new URL(typeof window === "undefined" ? page.url : window.location.href);
	}

	function buildTaskUrl(taskId: string | null) {
		const nextUrl = getCurrentTaskUrl();
		if (taskId) {
			nextUrl.searchParams.set("task", taskId);
		} else {
			nextUrl.searchParams.delete("task");
		}
		return nextUrl;
	}

	function buildTaskHistoryState(taskId: string | null): TaskHistoryState {
		return {
			...((page.state as TaskHistoryState | null | undefined) ?? {}),
			taskViewTaskId: taskId,
		};
	}

	function syncTaskUrl(taskId: string | null, mode: "push" | "replace" = "push") {
		if (!taskUrlRoutingReady) return;
		const currentUrl = getCurrentTaskUrl();
		const nextUrl = buildTaskUrl(taskId);
		const nextState = buildTaskHistoryState(taskId);
		if (nextUrl.toString() === currentUrl.toString()) return;
		if (mode === "replace") {
			replaceState(nextUrl, nextState);
			return;
		}
		pushState(nextUrl, nextState);
	}

	async function postAction(
		action: string,
		values: Record<string, string>,
		options?: {
			optimisticFocus?: (focus: FocusState | null, now: number) => FocusState | null;
		},
	) {
		if (options?.optimisticFocus) {
			optimisticFocus = options.optimisticFocus(focus, Date.now());
		}
		const formData = new FormData();
		for (const [key, value] of Object.entries(values)) {
			formData.set(key, value);
		}
		try {
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
		} finally {
			optimisticFocus = undefined;
		}
	}

	const enhanceToggle: SubmitFunction = ({ formData, cancel }) => {
		const id = formData.get("id")?.toString();
		if (!id) return;

		const todo = effectiveTodoMap.get(id);
		if (!todo) {
			cancel();
			return;
		}

		if (pendingToggleById[id]) {
			cancel();
			return;
		}

		setOptimisticDone(id, !todo.done);
		setPendingToggle(id, true);

		return async ({ result, update }) => {
			try {
				if (result.type === "success") {
					await update({ reset: false });
					return;
				}

				await applyAction(result);
			} finally {
				setOptimisticDone(id, null);
				setPendingToggle(id, false);
			}
		};
	};

	async function focusOnTask(taskId: string) {
		await postAction("focusTask", { taskId }, {
			optimisticFocus: (currentFocus, now) => upsertFocusedTask(currentFocus, taskId, now),
		});
		await tick();
		scrollFocusedHeroIntoView();
	}

	async function expandTask(taskId: string) {
		syncTaskUrl(taskId);
		await postAction("expandFocusTask", { taskId }, {
			optimisticFocus: (currentFocus, now) => expandFocusedTask(currentFocus, taskId, now),
		});
		await tick();
		scrollFocusedHeroIntoView();
	}

	async function openTaskInFocusView(taskId: string) {
		if (!activeTodoMap.has(taskId)) return;
		const task = getFocusedTask(visibleFocus, taskId);
		syncTaskUrl(taskId);
		if (task) {
			await postAction("expandFocusTask", { taskId });
			await tick();
			scrollFocusedHeroIntoView();
			return;
		}
		await tick();
		scrollFocusedHeroIntoView();
	}

	async function stopTask(taskId: string) {
		await postAction("stopFocusTask", { taskId }, {
			optimisticFocus: (currentFocus) => stopFocusedTask(currentFocus, taskId),
		});
	}

	async function closeTaskView() {
		const taskId = heroTaskId;
		if (!taskId) return;
		if (editingTaskId === taskId) {
			closeEditForm();
		}
		if (heroFocusTask?.taskId === taskId) {
			await stopTask(taskId);
		}
		syncTaskUrl(null);
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
		if (editingTaskId && !data.todos.some((t) => t.id === editingTaskId)) {
			editingTaskId = null;
		}
	});

	$effect(() => {
		if (!taskUrlRoutingReady) return;
		if (!requestedTaskId || activeTodoMap.has(requestedTaskId)) return;
		if (editingTaskId === requestedTaskId) {
			closeEditForm();
		}
		syncTaskUrl(null, "replace");
	});

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

	function formatDuration(ms: number): string {
		const totalMin = Math.round(ms / 60_000);
		if (totalMin < 60) return `${totalMin}m`;
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	function getTaskSessions(taskId: string): FocusSession[] {
		return data.sessions.filter(
			(s: FocusSession) => s.taskId === taskId && s.endedAt,
		);
	}

	function sessionSummary(taskId: string): string | null {
		const sessions = getTaskSessions(taskId);
		if (sessions.length === 0) return null;
		return `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`;
	}

	function averageSessionDuration(totalFocusMs: number, sessions: FocusSession[]): string {
		if (sessions.length === 0 || totalFocusMs <= 0) return "None";
		return formatDuration(totalFocusMs / sessions.length);
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
		for (const todo of effectiveTodos) {
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


</script>

<div class="home-layout">
	<main class="main-content">
			<header class="main-header home-header">
				<span class="tagline">Todo in your focus</span>
			</header>

		{#if collapsedFocusedTasks.length > 0}
			<section class="focus-stack" aria-label="Focused task stack">
				{#each collapsedFocusedTasks as task (task.taskId)}
					{@const taskTodo = effectiveTodoMap.get(task.taskId)}
					{#if taskTodo}
						<div class="focus-stack-row">
							<button
								type="button"
								class="focus-stack-summary"
								onclick={() => expandTask(task.taskId)}
								aria-label={`Expand ${taskTodo.title}`}
							>
								<span class="focus-stack-timer">
									{formatElapsed(getSessionElapsed(task, now))}
								</span>
								<span class="focus-stack-title">{taskTodo.title}</span>
							</button>
							<div class="focus-stack-actions">
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

		{#if focusedTodo}
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
						use:enhance={enhanceToggle}
					>
						<input type="hidden" name="id" value={focusedTodo.id} />
						<button
							type="submit"
							class="hero-toggle-btn"
							aria-label="Mark task done"
							disabled={Boolean(pendingToggleById[focusedTodo.id])}
							aria-busy={Boolean(pendingToggleById[focusedTodo.id])}
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
						{#if !heroFocusTask}
							<button
								class="hero-pause-icon"
								onclick={() => focusOnTask(focusedTodo.id)}
								aria-label="Start focus session"
								title="Start focus session"
							>▶</button>
						{/if}
						<button
							class="hero-close-icon"
							onclick={closeTaskView}
							aria-label={heroFocusTask ? "Close task and stop focus" : "Close task"}
							title={heroFocusTask ? "Close task and stop focus" : "Close task"}
						>✕</button>
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
					<div class="focus-session">
						<span class="focus-session-label">{heroFocusTask ? 'SESSION' : 'READY'}</span>
						<span class="focus-elapsed"
							>{heroFocusTask ? formatElapsed(sessionElapsed) : '00:00'}</span
						>
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
										<strong>{focusedLastSession?.endedAt ? formatSessionDate(focusedLastSession.endedAt) : "None"}</strong>
									</div>
									<div class="focus-stat">
										<span class="focus-stat-label">Avg session</span>
										<strong>{averageSessionDuration(focusedTodo.totalFocusMs ?? 0, focusedSessions)}</strong>
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
									<span>{focusedSessions.length} session{focusedSessions.length !== 1 ? "s" : ""}</span>
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
								{@const taskSessionSummary = sessionSummary(todo.id)}
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
									onclick={async (e: MouseEvent) => {
										if ((e.target as HTMLElement)?.closest?.('button, a, select, form')) return;
										if (todo.done) return;
										await openTaskInFocusView(todo.id);
									}}
								>
									<div class="todo-row">
										<form
											method="POST"
											action="?/toggle"
											class="toggle-form"
											use:enhance={enhanceToggle}
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
												disabled={Boolean(pendingToggleById[todo.id])}
												aria-busy={Boolean(pendingToggleById[todo.id])}
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
											onclick={async () => {
												if (todo.done) return;
												await openTaskInFocusView(todo.id);
											}}
										>{todo.title}</button
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
												<button onclick={() => stopTask(todo.id)}>STOP</button>
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

									{#if taskSessionSummary || lastLog || totalFocus > 0}
										<div class="task-meta">
											{#if totalFocus > 0}
												<span class="task-meta-item"
													>{formatDuration(totalFocus)} focused</span
												>
											{/if}
											{#if taskSessionSummary}
												<span class="task-meta-item"
													>{taskSessionSummary}</span
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

</div>
