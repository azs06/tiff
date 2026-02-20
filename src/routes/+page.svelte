<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';
	import type { TimerState, Todo } from '$lib/types';
	import { WORK_MS, nextInterval } from '$lib/pomodoro';

	let { data }: { data: PageData } = $props();

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
		// If it's end-of-day (23:59), just show the date
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

	let activeTodo = $derived(
		timer ? data.todos.find((t: { id: string }) => t.id === timer!.activeTaskId) : null
	);

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
		if (timer) {
			setTimer({ ...timer, activeTaskId: taskId });
		} else {
			setTimer({
				activeTaskId: taskId,
				startedAt: Date.now(),
				duration: WORK_MS,
				type: 'work',
				completedPomodoros: 0,
				paused: false
			});
		}
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
		const next = nextInterval(completed);
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
			duration: WORK_MS,
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

<div class="container">
	<header class="header">
		<h1>TIFF</h1>
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

	<section class="create-section">
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
</div>
