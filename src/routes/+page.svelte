<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';
	import type { TimerState, Todo, UserSettings } from '$lib/types';
	import { nextInterval } from '$lib/pomodoro';
	import Calendar from '$lib/Calendar.svelte';

	let { data }: { data: PageData } = $props();

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
	let expandedId = $state<string | null>(null);
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

	function expandTodo(todo: Todo) {
		if (expandedId === todo.id) {
			expandedId = null;
			return;
		}
		expandedId = todo.id;
		editDetail = todo.detail ?? '';
		editDeadlineChoice = todo.deadline ? 'custom' : 'none';
		editCustomDeadline = todo.deadline
			? new Date(todo.deadline - timezoneOffset * 60_000).toISOString().slice(0, 16)
			: '';
	}

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

	// Hydrate from server on mount (server always wins)
	$effect(() => {
		const server: TimerState | null = data.serverTimer;
		if (server) {
			timer = server;
			localStorage.setItem('tiff-timer', JSON.stringify(server));
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
	}

	function deactivate() {
		setTimer(null);
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

<div class="app-layout">
	<!-- Mobile overlay -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="sidebar-overlay"
		class:visible={sidebarOpen}
		onclick={closeSidebar}
		onkeydown={(e) => { if (e.key === 'Escape') closeSidebar(); }}
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
							longBreakMs: longBreakMin * 60000
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
						<button class="btn-hero" onclick={deactivate}>STOP</button>
					</div>
				{:else}
					<div class="timer-display">{formatTime(remaining)}</div>
					<div class="hero-controls">
						{#if timer.paused}
							<button class="btn-hero" onclick={resume}>RESUME</button>
						{:else}
							<button class="btn-hero" onclick={pause}>PAUSE</button>
						{/if}
						<button class="btn-hero" onclick={deactivate}>STOP</button>
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

								<span class="todo-title">{todo.title}</span>

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
									<button onclick={() => expandTodo(todo)}>EDIT</button>
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

							{#if expandedId === todo.id}
								<div class="todo-detail-panel">
									{#if todo.detail && expandedId !== todo.id}
										<p class="detail-text">{todo.detail}</p>
									{/if}
									<form
										method="POST"
										action="?/update"
										use:enhance={() => {
											return async ({ update }) => {
												await update({ reset: false });
												expandedId = null;
											};
										}}
									>
										<input type="hidden" name="id" value={todo.id} />
										<textarea name="detail" rows="3" placeholder="Add details...">{editDetail}</textarea>
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
										<div class="detail-actions">
											<button type="submit" class="btn-save">SAVE</button>
											<button type="button" onclick={() => expandedId = null}>CANCEL</button>
										</div>
									</form>
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
</div>
