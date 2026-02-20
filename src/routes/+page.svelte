<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import type { PageData } from './$types';
	import type { TimerState, UserSettings, Theme, PomodoroLog } from '$lib/types';
	import { THEMES } from '$lib/types';
	import { nextInterval } from '$lib/pomodoro';
	import Calendar from '$lib/Calendar.svelte';

	let { data }: { data: PageData } = $props();

	// ── Theme state ──
	let serverTheme = $derived(data.settings.theme);
	let theme = $state<Theme>('signal');
	let themeFormEl: HTMLFormElement;

	// Sync from server data
	$effect(() => {
		theme = serverTheme;
	});

	$effect(() => {
		localStorage.setItem('tiff-theme', theme);
		document.documentElement.setAttribute('data-theme', theme);
	});

	async function setTheme(t: Theme) {
		theme = t;
		await tick();
		themeFormEl?.requestSubmit();
	}

	// ── Sidebar state ──
	let sidebarOpen = $state(false);
	let sidebarPanel = $state<'settings' | 'archive' | 'calendar' | null>(null);
	let settingsOverride = $state<UserSettings | null>(null);
	let settings = $derived(settingsOverride ?? data.settings);

	// Settings form values (in minutes)
	let workMin = $state(0);
	let shortBreakMin = $state(0);
	let longBreakMin = $state(0);

	$effect(() => {
		workMin = Math.round(data.settings.workMs / 60000);
		shortBreakMin = Math.round(data.settings.shortBreakMs / 60000);
		longBreakMin = Math.round(data.settings.longBreakMs / 60000);
		settingsOverride = null;
	});

	function toggleSidebar(panel: 'settings' | 'archive' | 'calendar') {
		if (sidebarPanel === panel) {
			sidebarPanel = null;
		} else {
			sidebarPanel = panel;
		}
		sidebarOpen = sidebarPanel !== null;
	}

	function closeSidebar() {
		sidebarOpen = false;
		sidebarPanel = null;
	}

	// ── Detail/deadline state ──
	let timezoneOffset = $state(0);
	let deadlineChoice = $state<'none' | 'today' | 'tomorrow' | 'custom'>('none');
	let customDeadline = $state('');

	// Edit panel state
	let editDetail = $state('');
	let editDeadlineChoice = $state<'none' | 'today' | 'tomorrow' | 'custom'>('none');
	let editCustomDeadline = $state('');

	$effect(() => {
		timezoneOffset = new Date().getTimezoneOffset();
	});

	let createDeadlineValue = $derived(
		deadlineChoice === 'today'
			? 'today'
			: deadlineChoice === 'tomorrow'
				? 'tomorrow'
				: deadlineChoice === 'custom'
					? customDeadline
					: ''
	);

	let editDeadlineValue = $derived(
		editDeadlineChoice === 'today'
			? 'today'
			: editDeadlineChoice === 'tomorrow'
				? 'tomorrow'
				: editDeadlineChoice === 'custom'
					? editCustomDeadline
					: ''
	);

	function formatDeadline(ms: number): string {
		const d = new Date(ms);
		const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
		const month = months[d.getMonth()];
		const day = d.getDate();
		const h = d.getHours();
		const m = d.getMinutes();
		if (h === 23 && m === 59) return `${month} ${day}`;
		return `${month} ${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	}

	function isOverdue(ms: number): boolean {
		return Date.now() > ms;
	}

	// ── Client-side timer state (persisted to localStorage + server KV) ──
	let timer = $state<TimerState | null>(null);
	let remaining = $state(0);
	let expired = $state(false);
	let syncFormEl: HTMLFormElement;
	let timerJson = $derived(timer ? JSON.stringify(timer) : 'null');

	// Hydrate from server once on mount (server wins on initial load only)
	let timerHydrated = false;
	$effect(() => {
		if (timerHydrated) return;
		timerHydrated = true;
		const server: TimerState | null = data.serverTimer;
		if (server) {
			timer = server;
			localStorage.setItem('tiff-timer', JSON.stringify(server));
			detailTaskId = server.activeTaskId;
		} else {
			localStorage.removeItem('tiff-timer');
		}
	});

	// Persist timer to localStorage + sync to server KV
	function setTimer(next: TimerState | null) {
		timer = next;
		if (next) {
			localStorage.setItem('tiff-timer', JSON.stringify(next));
		} else {
			localStorage.removeItem('tiff-timer');
		}
		syncFormEl?.requestSubmit();
	}

	// Clean up timer if the active task was deleted
	$effect(() => {
		if (timer && !data.todos.some((t: { id: string }) => t.id === timer!.activeTaskId)) {
			setTimer(null);
		}
	});

	// Stop timer when the active task is marked done
	let activeTodo = $derived(
		timer ? data.todos.find((t: { id: string }) => t.id === timer!.activeTaskId) : null
	);

	$effect(() => {
		if (timer && activeTodo?.done) {
			setTimer(null);
		}
	});

	let timerLabel = $derived(
		timer
			? timer.type === 'work'
				? 'WORK'
				: timer.type === 'short-break'
					? 'SHORT BREAK'
					: 'LONG BREAK'
			: ''
	);

	let cyclesFilled = $derived(timer ? timer.completedPomodoros % 4 : 0);

	// ── Timer controls ──

	function activate(taskId: string) {
		setTimer({
			activeTaskId: taskId,
			startedAt: Date.now(),
			duration: settings.workMs,
			type: 'work',
			completedPomodoros: 0,
			paused: false
		});
		detailTaskId = taskId;
	}

	function closeTimer() {
		setTimer(null);
	}

	function reset() {
		if (!timer) return;
		const duration =
			timer.type === 'work'
				? settings.workMs
				: timer.type === 'short-break'
					? settings.shortBreakMs
					: settings.longBreakMs;
		setTimer({
			...timer,
			startedAt: Date.now(),
			duration,
			paused: false,
			pausedRemaining: undefined
		});
	}

	function pause() {
		if (!timer || timer.paused) return;
		setTimer({
			...timer,
			paused: true,
			pausedRemaining: Math.max(0, timer.startedAt + timer.duration - Date.now())
		});
	}

	function resume() {
		if (!timer || !timer.paused) return;
		const rem = timer.pausedRemaining ?? 0;
		setTimer({
			...timer,
			startedAt: Date.now(),
			duration: rem,
			paused: false,
			pausedRemaining: undefined
		});
	}

	function startBreak() {
		if (!timer) return;
		const completed =
			timer.type === 'work' ? timer.completedPomodoros + 1 : timer.completedPomodoros;
		const next = nextInterval(completed, settings);
		logPomodoroToServer();
		setTimer({
			...timer,
			startedAt: Date.now(),
			duration: next.duration,
			type: next.type,
			completedPomodoros: completed,
			paused: false,
			pausedRemaining: undefined
		});
	}

	function startWork() {
		if (!timer) return;
		setTimer({
			...timer,
			startedAt: Date.now(),
			duration: settings.workMs,
			type: 'work',
			paused: false,
			pausedRemaining: undefined
		});
	}

	// ── Backend logging ──

	let logFormEl: HTMLFormElement;

	function logPomodoroToServer() {
		if (!timer) return;
		logFormEl?.requestSubmit();
	}

	$effect(() => {
		if (!timer) {
			remaining = 0;
			expired = false;
			return;
		}

		if (timer.paused) {
			remaining = Math.max(0, timer.pausedRemaining ?? 0);
			expired = remaining === 0;
			return;
		}

		const { startedAt, duration } = timer;
		const tick = () => {
			remaining = Math.max(0, startedAt + duration - Date.now());
			expired = remaining === 0;
		};

		tick();
		const intervalId = setInterval(tick, 1000);
		return () => clearInterval(intervalId);
	});

	function formatTime(ms: number): string {
		const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
	}

	// ── Detail panel state ──
	let detailTaskId = $state<string | null>(null);
	let detailOpen = $derived(detailTaskId !== null);

	let detailTodo = $derived(
		detailTaskId ? [...data.todos, ...data.archivedTodos].find((t) => t.id === detailTaskId) ?? null : null
	);

	function openDetail(todoId: string) {
		detailTaskId = todoId;
		const todo = [...data.todos, ...data.archivedTodos].find((t) => t.id === todoId);
		if (todo) {
			editDetail = todo.detail ?? '';
			editDeadlineChoice = todo.deadline ? 'custom' : 'none';
			editCustomDeadline = todo.deadline
				? new Date(todo.deadline - timezoneOffset * 60_000).toISOString().slice(0, 16)
				: '';
		}
	}

	function closeDetail() {
		detailTaskId = null;
	}

	// Close detail if the task is deleted
	$effect(() => {
		if (detailTaskId && ![...data.todos, ...data.archivedTodos].some((t) => t.id === detailTaskId)) {
			detailTaskId = null;
		}
	});

	// ── Domain auto-detection ──
	const DOMAIN_LABELS: Record<string, string> = {
		'github.com': 'GitHub',
		'docs.google.com': 'Google Docs',
		'figma.com': 'Figma',
		'www.figma.com': 'Figma',
		'notion.so': 'Notion',
		'www.notion.so': 'Notion',
		'linear.app': 'Linear',
		'jira.atlassian.net': 'Jira'
	};

	function getDomainLabel(url: string): string {
		try {
			const hostname = new URL(url).hostname;
			return DOMAIN_LABELS[hostname] ?? hostname;
		} catch {
			return 'Link';
		}
	}

	// ── Relative time ──
	function relativeTime(timestamp: number): string {
		const diff = Date.now() - timestamp;
		const mins = Math.floor(diff / 60_000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	}

	// ── Pomodoro summary helpers ──
	function getTaskPomodoros(taskId: string): PomodoroLog[] {
		return data.pomodoroLogs.filter((l: PomodoroLog) => l.taskId === taskId && l.type === 'work');
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
		return `${logs.length} session${logs.length !== 1 ? 's' : ''} · ${formatDuration(total)}`;
	}
</script>

<!-- Hidden form for logging completed pomodoros to the server -->
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
	<input type="hidden" name="taskId" value={timer?.activeTaskId ?? ''} />
	<input type="hidden" name="type" value={timer?.type ?? ''} />
	<input type="hidden" name="duration" value={String(timer?.duration ?? 0)} />
</form>

<!-- Hidden form for syncing timer state to server KV -->
<form
	method="POST"
	action="?/syncTimer"
	use:enhance={() => {
		return async ({ update }) => {
			await update({ reset: false, invalidateAll: false });
		};
	}}
	bind:this={syncFormEl}
	hidden
>
	<input type="hidden" name="timer" value={timerJson} />
</form>

<!-- Hidden form for persisting theme to server KV -->
<form
	method="POST"
	action="?/saveTheme"
	use:enhance={() => {
		return async ({ update }) => {
			await update({ reset: false, invalidateAll: false });
		};
	}}
	bind:this={themeFormEl}
	hidden
>
	<input type="hidden" name="theme" value={theme} />
</form>

<div class="app-layout" class:detail-open={detailOpen}>
	<!-- Mobile overlay for left sidebar -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="sidebar-overlay"
		class:visible={sidebarOpen}
		onclick={closeSidebar}
		onkeydown={(e) => { if (e.key === 'Escape') closeSidebar(); }}
	></div>

	<!-- Mobile overlay for detail panel -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="detail-overlay"
		class:visible={detailOpen}
		onclick={closeDetail}
		onkeydown={(e) => { if (e.key === 'Escape') closeDetail(); }}
	></div>

	<aside class="sidebar" class:open={sidebarOpen}>
		<div class="sidebar-header">
			<h1>TIFF</h1>
			<button class="sidebar-close" onclick={closeSidebar}>X</button>
		</div>
		<nav class="sidebar-nav">
			<button
				class="sidebar-tab"
				class:active={sidebarPanel === 'settings'}
				onclick={() => toggleSidebar('settings')}
			>SETTINGS</button>
			<button
				class="sidebar-tab"
				class:active={sidebarPanel === 'archive'}
				onclick={() => toggleSidebar('archive')}
			>ARCHIVE</button>
			<button
				class="sidebar-tab"
				class:active={sidebarPanel === 'calendar'}
				onclick={() => toggleSidebar('calendar')}
			>CALENDAR</button>
		</nav>

		<div class="theme-switcher">
			{#each THEMES as t}
				<button
					class="theme-btn"
					class:active={theme === t}
					onclick={() => setTheme(t)}
				>{t.toUpperCase()}</button>
			{/each}
		</div>

		{#if sidebarPanel === 'settings'}
			<div class="sidebar-panel">
				<div class="sidebar-panel-title">TIMER SETTINGS</div>
				<form
					method="POST"
					action="?/saveSettings"
					use:enhance={() => {
						// Optimistically update local settings
						settingsOverride = {
							workMs: workMin * 60000,
							shortBreakMs: shortBreakMin * 60000,
							longBreakMs: longBreakMin * 60000,
							theme
						};
						return async ({ update }) => {
							await update({ reset: false });
						};
					}}
				>
					<div class="settings-field">
						<label class="settings-label" for="work">Work (minutes)</label>
						<input
							class="settings-input"
							type="number"
							id="work"
							name="work"
							min="1"
							max="120"
							bind:value={workMin}
						/>
					</div>
					<div class="settings-field">
						<label class="settings-label" for="shortBreak">Short break (minutes)</label>
						<input
							class="settings-input"
							type="number"
							id="shortBreak"
							name="shortBreak"
							min="1"
							max="120"
							bind:value={shortBreakMin}
						/>
					</div>
					<div class="settings-field">
						<label class="settings-label" for="longBreak">Long break (minutes)</label>
						<input
							class="settings-input"
							type="number"
							id="longBreak"
							name="longBreak"
							min="1"
							max="120"
							bind:value={longBreakMin}
						/>
					</div>
					<div class="settings-hint">Long break triggers every 4 pomodoros</div>
					<button type="submit" class="btn-save" style="margin-top: 1rem; width: 100%;">SAVE</button>
				</form>
			</div>
		{/if}

		{#if sidebarPanel === 'archive'}
			<div class="sidebar-panel">
				<div class="sidebar-panel-title">ARCHIVED TASKS</div>
				{#if data.archivedTodos.length > 0}
					{#each data.archivedTodos as todo (todo.id)}
						<div class="archive-item">
							<span class="archive-title">{todo.title}</span>
							<div class="archive-actions">
								<form method="POST" action="?/unarchive" use:enhance>
									<input type="hidden" name="id" value={todo.id} />
									<button type="submit">RESTORE</button>
								</form>
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="id" value={todo.id} />
									<button type="submit" class="btn-danger">DEL</button>
								</form>
							</div>
						</div>
					{/each}
				{:else}
					<div class="archive-empty">No archived tasks</div>
				{/if}
			</div>
		{/if}

		{#if sidebarPanel === 'calendar'}
			<div class="sidebar-panel">
				<div class="sidebar-panel-title">ACTIVITY</div>
				<Calendar pomodoroLogs={data.pomodoroLogs} todos={data.todos} />
			</div>
		{/if}
	</aside>

	<main class="main-content">
		<header class="main-header">
			<button class="menu-btn" onclick={() => { sidebarOpen = !sidebarOpen; if (!sidebarPanel) sidebarPanel = 'settings'; }}>MENU</button>
			<span class="tagline">Todo in your focus</span>
		</header>

		{#if timer && activeTodo}
			<section class="hero" class:expired>
				<button class="hero-close" onclick={closeTimer} aria-label="Close timer">✕</button>
				<div class="hero-label">{timerLabel}</div>
				<div class="hero-task">{activeTodo.title}</div>

				{#if expired}
					<div class="expired-message">TIME'S UP</div>
					<div class="hero-controls">
						{#if timer.type === 'work'}
							<button class="btn-hero btn-accent" onclick={startBreak}>START BREAK</button>
						{:else}
							<button class="btn-hero btn-accent" onclick={startWork}>START WORK</button>
						{/if}
						<button class="btn-hero" onclick={reset}>RESET</button>
					</div>
				{:else}
					<div class="timer-display">{formatTime(remaining)}</div>
					<div class="hero-controls">
						{#if timer.paused}
							<button class="btn-hero btn-accent" onclick={resume}>RESUME</button>
						{:else}
							<button class="btn-hero" onclick={pause}>PAUSE</button>
						{/if}
						<button class="btn-hero" onclick={reset}>RESET</button>
					</div>
				{/if}

				<div class="cycles">
					{#each Array(4) as _, i}
						<span class="dot" class:filled={i < cyclesFilled}></span>
					{/each}
				</div>
			</section>
		{/if}

		<section class="create-section" data-label="NEW TASK">
			<form
				method="POST"
				action="?/create"
				class="create-form"
				use:enhance={() => {
					return async ({ update }) => {
						await update();
						deadlineChoice = 'none';
						customDeadline = '';
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
					/>
					<button type="submit">ADD</button>
				</div>
				<div class="create-extras">
					<textarea name="detail" placeholder="Details (optional)" rows="2"></textarea>
					<div class="deadline-row">
						<span class="deadline-label">DEADLINE:</span>
						<button type="button" class="deadline-opt" class:selected={deadlineChoice === 'none'} onclick={() => deadlineChoice = 'none'}>NONE</button>
						<button type="button" class="deadline-opt" class:selected={deadlineChoice === 'today'} onclick={() => deadlineChoice = 'today'}>TODAY</button>
						<button type="button" class="deadline-opt" class:selected={deadlineChoice === 'tomorrow'} onclick={() => deadlineChoice = 'tomorrow'}>TOMORROW</button>
						<button type="button" class="deadline-opt" class:selected={deadlineChoice === 'custom'} onclick={() => deadlineChoice = 'custom'}>CUSTOM</button>
						{#if deadlineChoice === 'custom'}
							<input type="datetime-local" class="deadline-datetime" bind:value={customDeadline} />
						{/if}
					</div>
					<input type="hidden" name="deadline" value={createDeadlineValue} />
					<input type="hidden" name="timezoneOffset" value={String(timezoneOffset)} />
				</div>
			</form>
		</section>

		<section class="task-section" data-label="TASK QUEUE">
			{#if data.todos.length > 0}
				<ul class="todo-list">
					{#each data.todos as todo (todo.id)}
						{@const taskPomSummary = pomodoroSummary(todo.id)}
						{@const resourceCount = todo.resources?.length ?? 0}
						{@const lastLog = todo.logs?.length ? todo.logs[todo.logs.length - 1] : null}
						<li
							class="todo-item"
							class:done={todo.done}
							class:active={timer?.activeTaskId === todo.id}
						>
							<div class="todo-row">
								<form method="POST" action="?/toggle" class="toggle-form" use:enhance>
									<input type="hidden" name="id" value={todo.id} />
									<button type="submit" class="toggle-btn" class:checked={todo.done}>
										{todo.done ? '✓' : ''}
									</button>
								</form>

								{#if todo.deadline && !todo.done && isOverdue(todo.deadline)}
									<span class="status-tag urgent">(OVERDUE)</span>
								{:else if timer?.activeTaskId === todo.id}
									<span class="status-tag active">[ACTIVE]</span>
								{/if}

								<button class="todo-title" onclick={() => openDetail(todo.id)}>{todo.title}</button>

								{#if todo.deadline}
									<span class="deadline-badge" class:overdue={!todo.done && isOverdue(todo.deadline)}>
										{formatDeadline(todo.deadline)}
									</span>
								{/if}

								<div class="todo-actions">
									{#if !todo.done && timer?.activeTaskId !== todo.id}
										<button onclick={() => activate(todo.id)}>FOCUS</button>
									{/if}
									{#if todo.done}
										<form method="POST" action="?/archive" use:enhance>
											<input type="hidden" name="id" value={todo.id} />
											<button type="submit">ARCHIVE</button>
										</form>
									{/if}
									<form method="POST" action="?/delete" use:enhance>
										<input type="hidden" name="id" value={todo.id} />
										<button
											type="submit"
											class="btn-danger"
											onclick={() => {
												if (timer?.activeTaskId === todo.id) setTimer(null);
											}}
										>DEL</button>
									</form>
								</div>
							</div>

							{#if taskPomSummary || resourceCount > 0 || lastLog}
								<div class="task-meta">
									{#if taskPomSummary}
										<span class="task-meta-item">{taskPomSummary}</span>
									{/if}
									{#if resourceCount > 0}
										<span class="task-meta-item">{resourceCount} link{resourceCount !== 1 ? 's' : ''}</span>
									{/if}
									{#if lastLog}
										<span class="task-meta-item">{lastLog.text.slice(0, 40)}{lastLog.text.length > 40 ? '...' : ''} · {relativeTime(lastLog.createdAt)}</span>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<div class="empty">No tasks yet. Add one above.</div>
			{/if}
		</section>
	</main>

	{#if detailTodo}
		{@const detailPomodoros = getTaskPomodoros(detailTodo.id)}
		<aside class="detail-panel" class:open={detailOpen}>
			<div class="detail-header">
				<div class="detail-header-info">
					<div class="detail-title">{detailTodo.title}</div>
					<div class="detail-badges">
						{#if detailTodo.done}
							<span class="detail-badge done">DONE</span>
						{:else if timer?.activeTaskId === detailTodo.id}
							<span class="detail-badge active">ACTIVE</span>
						{/if}
						{#if detailTodo.deadline && !detailTodo.done && isOverdue(detailTodo.deadline)}
							<span class="detail-badge overdue">OVERDUE</span>
						{/if}
					</div>
				</div>
				<button class="detail-close" onclick={closeDetail}>✕</button>
			</div>

			<!-- Details (edit) -->
			<div class="detail-section">
				<div class="detail-section-title">DETAILS</div>
				<form
					class="detail-form"
					method="POST"
					action="?/update"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: false });
						};
					}}
				>
					<input type="hidden" name="id" value={detailTodo.id} />
					<textarea name="detail" rows="3" placeholder="Add details..." bind:value={editDetail}></textarea>
					<div class="deadline-row">
						<span class="deadline-label">DEADLINE:</span>
						<button type="button" class="deadline-opt" class:selected={editDeadlineChoice === 'none'} onclick={() => editDeadlineChoice = 'none'}>NONE</button>
						<button type="button" class="deadline-opt" class:selected={editDeadlineChoice === 'today'} onclick={() => editDeadlineChoice = 'today'}>TODAY</button>
						<button type="button" class="deadline-opt" class:selected={editDeadlineChoice === 'tomorrow'} onclick={() => editDeadlineChoice = 'tomorrow'}>TOMORROW</button>
						<button type="button" class="deadline-opt" class:selected={editDeadlineChoice === 'custom'} onclick={() => editDeadlineChoice = 'custom'}>CUSTOM</button>
						{#if editDeadlineChoice === 'custom'}
							<input type="datetime-local" class="deadline-datetime" bind:value={editCustomDeadline} />
						{/if}
					</div>
					<input type="hidden" name="deadline" value={editDeadlineValue} />
					<input type="hidden" name="timezoneOffset" value={String(timezoneOffset)} />
					<button type="submit" class="btn-save">SAVE</button>
				</form>
			</div>

			<!-- Time summary -->
			{#if detailPomodoros.length > 0}
				<div class="detail-section">
					<div class="detail-section-title">TIME</div>
					<div class="time-summary">
						<strong>{detailPomodoros.length} session{detailPomodoros.length !== 1 ? 's' : ''}</strong> · {formatDuration(detailPomodoros.reduce((s, l) => s + l.duration, 0))} total
					</div>
				</div>
			{/if}

			<!-- Resources -->
			<div class="detail-section">
				<div class="detail-section-title">RESOURCES</div>
				{#if detailTodo.resources && detailTodo.resources.length > 0}
					<div class="resource-list">
						{#each detailTodo.resources as resource (resource.id)}
							<div class="resource-item">
								<span class="resource-label">{resource.label || getDomainLabel(resource.url)}</span>
								<a class="resource-url" href={resource.url} target="_blank" rel="noopener noreferrer">{resource.url}</a>
								<form method="POST" action="?/deleteResource" use:enhance>
									<input type="hidden" name="id" value={detailTodo.id} />
									<input type="hidden" name="resourceId" value={resource.id} />
									<button type="submit" class="resource-delete">✕</button>
								</form>
							</div>
						{/each}
					</div>
				{/if}
				<form
					class="detail-form"
					method="POST"
					action="?/addResource"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: true });
						};
					}}
				>
					<input type="hidden" name="id" value={detailTodo.id} />
					<div class="detail-form-row">
						<input type="url" name="url" placeholder="https://..." required />
					</div>
					<div class="detail-form-row">
						<input type="text" name="label" placeholder="Label (optional)" />
						<button type="submit">ADD</button>
					</div>
				</form>
			</div>

			<!-- Activity log -->
			<div class="detail-section">
				<div class="detail-section-title">ACTIVITY LOG</div>
				{#if detailTodo.logs && detailTodo.logs.length > 0}
					<div class="log-list">
						{#each [...detailTodo.logs].reverse() as log (log.id)}
							<div class="log-entry">
								<div class="log-entry-header">
									<span class="log-time">{relativeTime(log.createdAt)}</span>
									<form method="POST" action="?/deleteLog" use:enhance>
										<input type="hidden" name="id" value={detailTodo.id} />
										<input type="hidden" name="logId" value={log.id} />
										<button type="submit" class="log-delete">✕</button>
									</form>
								</div>
								<div class="log-text">{log.text}</div>
							</div>
						{/each}
					</div>
				{/if}
				<form
					class="detail-form"
					method="POST"
					action="?/addLog"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: true });
						};
					}}
				>
					<input type="hidden" name="id" value={detailTodo.id} />
					<textarea name="text" rows="2" placeholder="What did you work on?" required></textarea>
					<button type="submit">ADD LOG</button>
				</form>
			</div>
		</aside>
	{/if}
</div>
