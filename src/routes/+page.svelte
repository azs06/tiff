<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import type { PageData } from './$types';
	import type { FocusState, UserSettings, Theme, PomodoroLog, FocusSession } from '$lib/types';
	import { THEMES } from '$lib/types';
	import { nextInterval } from '$lib/pomodoro';
	import Calendar from '$lib/Calendar.svelte';

	let { data }: { data: PageData } = $props();

	// ── Theme state ──
	let serverTheme = $derived(data.settings.theme);
	let theme = $state<Theme>('signal');
	let themeFormEl: HTMLFormElement;

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
	let leftSidebarCollapsed = $state(false);
	let sidebarPanel = $state<'settings' | 'archive' | 'calendar' | 'projects' | null>(null);
	let settingsOverride = $state<UserSettings | null>(null);
	let settings = $derived(settingsOverride ?? data.settings);

	let workMin = $state(0);
	let shortBreakMin = $state(0);
	let longBreakMin = $state(0);

	$effect(() => {
		workMin = Math.round(data.settings.workMs / 60000);
		shortBreakMin = Math.round(data.settings.shortBreakMs / 60000);
		longBreakMin = Math.round(data.settings.longBreakMs / 60000);
		settingsOverride = null;
	});

	function toggleSidebar(panel: 'settings' | 'archive' | 'calendar' | 'projects') {
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
	let createProjectId = $state('');

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

	// ── Focus state (replaces timer state) ──
	let focus = $state<FocusState | null>(null);
	let syncFocusFormEl: HTMLFormElement;
	let focusFormEl: HTMLFormElement;
	let unfocusFormEl: HTMLFormElement;
	let focusJson = $derived(focus ? JSON.stringify(focus) : 'null');

	// Hydrate from server on mount
	let focusHydrated = false;
	$effect(() => {
		if (focusHydrated) return;
		focusHydrated = true;
		const server: FocusState | null = data.serverFocus;
		if (server) {
			focus = server;
			localStorage.setItem('tiff-focus', JSON.stringify(server));
			detailTaskId = server.activeTaskId;
		} else {
			localStorage.removeItem('tiff-focus');
		}
	});

	function setFocus(next: FocusState | null) {
		focus = next;
		if (next) {
			localStorage.setItem('tiff-focus', JSON.stringify(next));
		} else {
			localStorage.removeItem('tiff-focus');
		}
		syncFocusFormEl?.requestSubmit();
	}

	// Clean up focus if the active task was deleted
	$effect(() => {
		if (focus && !data.todos.some((t: { id: string }) => t.id === focus!.activeTaskId)) {
			setFocus(null);
		}
	});

	let focusedTodo = $derived(
		focus ? data.todos.find((t: { id: string }) => t.id === focus!.activeTaskId) : null
	);

	// Auto-clear focus when focused task is marked done
	$effect(() => {
		if (focus && focusedTodo?.done) {
			setFocus(null);
		}
	});

	// ── Session elapsed counter ──
	let sessionElapsed = $state(0);

	$effect(() => {
		if (!focus) {
			sessionElapsed = 0;
			return;
		}
		const start = focus.focusedAt;
		const tick = () => { sessionElapsed = Date.now() - start; };
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
			return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
		}
		return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
	}

	// ── Pomodoro controls (nested under focus) ──
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
			? focus.pomodoro.type === 'work'
				? 'WORK'
				: focus.pomodoro.type === 'short-break'
					? 'SHORT BREAK'
					: 'LONG BREAK'
			: ''
	);

	let cyclesFilled = $derived(focus?.pomodoro ? focus.pomodoro.completedPomodoros % 4 : 0);

	function formatTime(ms: number): string {
		const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
	}

	// Focus on a task (replaces activate)
	function focusOnTask(taskId: string) {
		setFocus({
			activeTaskId: taskId,
			focusedAt: Date.now()
		});
		detailTaskId = taskId;
		// Notify server to start session
		tick().then(() => focusFormEl?.requestSubmit());
	}

	function unfocusTask() {
		setFocus(null);
		unfocusFormEl?.requestSubmit();
	}

	// Start pomodoro within current focus
	function startPomodoro() {
		if (!focus) return;
		setFocus({
			...focus,
			pomodoro: {
				startedAt: Date.now(),
				duration: settings.workMs,
				type: 'work',
				completedPomodoros: 0,
				paused: false
			}
		});
	}

	function pomoPause() {
		if (!focus?.pomodoro || focus.pomodoro.paused) return;
		setFocus({
			...focus,
			pomodoro: {
				...focus.pomodoro,
				paused: true,
				pausedRemaining: Math.max(0, focus.pomodoro.startedAt + focus.pomodoro.duration - Date.now())
			}
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
				pausedRemaining: undefined
			}
		});
	}

	function pomoReset() {
		if (!focus?.pomodoro) return;
		const duration =
			focus.pomodoro.type === 'work'
				? settings.workMs
				: focus.pomodoro.type === 'short-break'
					? settings.shortBreakMs
					: settings.longBreakMs;
		setFocus({
			...focus,
			pomodoro: {
				...focus.pomodoro,
				startedAt: Date.now(),
				duration,
				paused: false,
				pausedRemaining: undefined
			}
		});
	}

	function pomoStartBreak() {
		if (!focus?.pomodoro) return;
		const completed =
			focus.pomodoro.type === 'work'
				? focus.pomodoro.completedPomodoros + 1
				: focus.pomodoro.completedPomodoros;
		const next = nextInterval(completed, settings);
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
				pausedRemaining: undefined
			}
		});
	}

	function pomoStartWork() {
		if (!focus?.pomodoro) return;
		setFocus({
			...focus,
			pomodoro: {
				...focus.pomodoro,
				startedAt: Date.now(),
				duration: settings.workMs,
				type: 'work',
				paused: false,
				pausedRemaining: undefined
			}
		});
	}

	function pomoStop() {
		if (!focus) return;
		setFocus({
			...focus,
			pomodoro: undefined
		});
	}

	function logPomodoroToServer() {
		if (!focus?.pomodoro) return;
		logFormEl?.requestSubmit();
	}

	// ── Detail panel state ──
	let detailTaskId = $state<string | null>(null);
	let detailVisible = $state(true);
	let detailOpen = $derived(detailTaskId !== null && detailVisible);

	let detailTodo = $derived(
		detailTaskId ? [...data.todos, ...data.archivedTodos].find((t) => t.id === detailTaskId) ?? null : null
	);

	function openDetail(todoId: string) {
		detailTaskId = todoId;
		detailVisible = true;
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

	// ── Simple markdown renderer ──
	function renderMarkdown(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>')
			.replace(/`(.+?)`/g, '<code>$1</code>')
			.replace(/~~(.+?)~~/g, '<del>$1</del>')
			.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
			.replace(/^- (.+)$/gm, '<li>$1</li>')
			.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
			.replace(/\n/g, '<br>');
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
		return `${logs.length} pomo${logs.length !== 1 ? 's' : ''} · ${formatDuration(total)}`;
	}

	// ── Session helpers ──
	function getTaskSessions(taskId: string): FocusSession[] {
		return data.sessions.filter((s: FocusSession) => s.taskId === taskId && s.endedAt);
	}

	function sessionDuration(session: FocusSession): number {
		if (!session.endedAt) return 0;
		return session.endedAt - session.startedAt;
	}

	function formatSessionDate(timestamp: number): string {
		const d = new Date(timestamp);
		const now = new Date();
		const isToday = d.toDateString() === now.toDateString();
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 1);
		const isYesterday = d.toDateString() === yesterday.toDateString();
		if (isToday) return 'Today';
		if (isYesterday) return 'Yesterday';
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		return `${months[d.getMonth()]} ${d.getDate()}`;
	}

	// ── Project helpers ──
	function getProjectName(projectId: string): string {
		return data.projects.find((p: { id: string }) => p.id === projectId)?.name ?? 'Unknown';
	}

	function getProjectTaskCount(projectId: string): number {
		return data.todos.filter((t: { projectId?: string; done: boolean }) => t.projectId === projectId && !t.done).length;
	}

	let globalTasks = $derived(data.todos.filter((t: { projectId?: string }) => !t.projectId));
	let projectsWithTasks = $derived(
		data.projects.map((p) => ({
			id: p.id,
			name: p.name,
			createdAt: p.createdAt,
			tasks: data.todos.filter((t: { projectId?: string }) => t.projectId === p.id)
		}))
	);

	// Latest log for focused task
	let focusedLastLog = $derived(
		focusedTodo?.logs?.length ? focusedTodo.logs[focusedTodo.logs.length - 1] : null
	);

	// ── Prev/next task navigation ──
	let activeTasks = $derived(data.todos.filter((t: { done: boolean }) => !t.done));
	let focusedIndex = $derived(
		focus ? activeTasks.findIndex((t: { id: string }) => t.id === focus!.activeTaskId) : -1
	);
	let prevTask = $derived(focusedIndex > 0 ? activeTasks[focusedIndex - 1] : null);
	let nextTask = $derived(focusedIndex >= 0 && focusedIndex < activeTasks.length - 1 ? activeTasks[focusedIndex + 1] : null);

	function focusPrev() {
		if (prevTask) focusOnTask(prevTask.id);
	}

	function focusNext() {
		if (nextTask) focusOnTask(nextTask.id);
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
	<input type="hidden" name="taskId" value={focus?.activeTaskId ?? ''} />
	<input type="hidden" name="type" value={focus?.pomodoro?.type ?? ''} />
	<input type="hidden" name="duration" value={String(focus?.pomodoro?.duration ?? 0)} />
</form>

<!-- Hidden form for syncing focus state to server KV -->
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

<!-- Hidden form for server-side focus/session start -->
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
	<input type="hidden" name="taskId" value={focus?.activeTaskId ?? ''} />
</form>

<!-- Hidden form for server-side unfocus/session end -->
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
>
</form>

<div class="app-layout" class:detail-open={detailOpen} class:sidebar-collapsed={leftSidebarCollapsed}>
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
				class:active={sidebarPanel === 'projects'}
				onclick={() => toggleSidebar('projects')}
			>PROJECTS</button>
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

		{#if sidebarPanel === 'projects'}
			<div class="sidebar-panel">
				<div class="sidebar-panel-title">PROJECTS</div>
				<form
					method="POST"
					action="?/createProject"
					class="project-create-form"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: true });
						};
					}}
				>
					<input type="text" name="name" placeholder="New project..." required autocomplete="off" />
					<button type="submit">ADD</button>
				</form>
				{#if data.projects.length > 0}
					{#each data.projects as project (project.id)}
						<div class="project-item">
							<span class="project-name">{project.name.toUpperCase()}</span>
							<span class="project-count">{getProjectTaskCount(project.id)}</span>
							<form method="POST" action="?/deleteProject" use:enhance>
								<input type="hidden" name="id" value={project.id} />
								<button type="submit" class="btn-danger">DEL</button>
							</form>
						</div>
					{/each}
				{:else}
					<div class="archive-empty">No projects yet</div>
				{/if}
			</div>
		{/if}

		{#if sidebarPanel === 'settings'}
			<div class="sidebar-panel">
				<div class="sidebar-panel-title">TIMER SETTINGS</div>
				<form
					method="POST"
					action="?/saveSettings"
					use:enhance={() => {
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
				<div class="sidebar-panel-title" style="margin-top: 1.5rem;">THEME</div>
				<div class="theme-switcher">
					{#each THEMES as t}
						<button
							class="theme-btn"
							class:active={theme === t}
							onclick={() => setTheme(t)}
						>{t.toUpperCase()}</button>
					{/each}
				</div>
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
			<button class="menu-btn" onclick={() => { sidebarOpen = !sidebarOpen; if (!sidebarPanel) sidebarPanel = 'projects'; }}>MENU</button>
			<button class="toggle-sidebar-btn" onclick={() => leftSidebarCollapsed = !leftSidebarCollapsed} title={leftSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
				{leftSidebarCollapsed ? '☰' : '◀'}
			</button>
			<span class="tagline">Todo in your focus</span>
			{#if detailTaskId}
				<button class="toggle-detail-btn" onclick={toggleDetail} title={detailOpen ? 'Hide details' : 'Show details'}>
					{detailOpen ? '▶' : '◀'} DETAILS
				</button>
			{/if}
		</header>

		<!-- Focused task card (replaces giant timer hero) -->
		{#if focus && focusedTodo}
			<section class="hero-focus">
				<div class="focus-top-bar">
					{#if focusedTodo.projectId}
						<span class="focus-project">{getProjectName(focusedTodo.projectId).toUpperCase()}</span>
					{/if}
					<form method="POST" action="?/toggle" class="toggle-form" use:enhance>
						<input type="hidden" name="id" value={focusedTodo.id} />
						<button type="submit" class="hero-toggle-btn" aria-label="Mark task done"><span class="hero-toggle-label">DONE</span></button>
					</form>
					<button class="hero-close" onclick={unfocusTask} aria-label="Unfocus task">UNFOCUS</button>
				</div>

				<div class="focus-nav-row">
					{#if prevTask}
						<button class="focus-nav-btn" onclick={focusPrev} aria-label="Previous task" title={prevTask.title}>&larr;</button>
					{/if}
					<h2 class="focus-title">{focusedTodo.title}</h2>
					{#if nextTask}
						<button class="focus-nav-btn" onclick={focusNext} aria-label="Next task" title={nextTask.title}>&rarr;</button>
					{/if}
				</div>

				{#if focusedTodo.detail}
					<p class="focus-detail">{focusedTodo.detail}</p>
				{/if}

				{#if focusedLastLog}
					<div class="focus-last-log">
						<span class="focus-log-label">LAST LOG</span>
						<span class="focus-log-time">{relativeTime(focusedLastLog.createdAt)}</span>
						<p class="focus-log-text">{@html renderMarkdown(focusedLastLog.text)}</p>
					</div>
				{/if}

				<div class="focus-bottom">
					<div class="focus-session">
						<span class="focus-session-label">SESSION</span>
						<span class="focus-elapsed">{formatElapsed(sessionElapsed)}</span>
					</div>

					<div class="focus-pomodoro">
						{#if focus.pomodoro}
							<div class="pomo-pill" class:expired={pomoExpired}>
								{#if pomoExpired}
									<span class="pomo-label">TIME'S UP</span>
									{#if focus.pomodoro.type === 'work'}
										<button class="pomo-action" onclick={pomoStartBreak}>BREAK</button>
									{:else}
										<button class="pomo-action" onclick={pomoStartWork}>WORK</button>
									{/if}
								{:else}
									<span class="pomo-time">{formatTime(pomoRemaining)}</span>
									<span class="pomo-type">{pomoLabel}</span>
									{#if focus.pomodoro.paused}
										<button class="pomo-action" onclick={pomoResume}>GO</button>
									{:else}
										<button class="pomo-action" onclick={pomoPause}>PAUSE</button>
									{/if}
									<button class="pomo-action" onclick={pomoReset}>RESET</button>
								{/if}
								<button class="pomo-action pomo-stop" onclick={pomoStop}>STOP</button>
								<div class="pomo-dots">
									{#each Array(4) as _, i}
										<span class="pomo-dot" class:filled={i < cyclesFilled}></span>
									{/each}
								</div>
							</div>
						{:else}
							<button class="pomo-start-btn" onclick={startPomodoro}>START POMODORO</button>
						{/if}
					</div>
				</div>

				<!-- Quick log form (textarea with markdown) -->
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
					<textarea name="text" rows="3" placeholder="What did you just do? (supports markdown)" required></textarea>
					<button type="submit">LOG</button>
				</form>
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
						createProjectId = '';
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
					{#if data.projects.length > 0}
						<div class="project-row">
							<span class="project-label">PROJECT:</span>
							<select class="project-select" name="projectId" bind:value={createProjectId}>
								<option value="">GLOBAL</option>
								{#each data.projects as p (p.id)}
									<option value={p.id}>{p.name.toUpperCase()}</option>
								{/each}
							</select>
						</div>
					{/if}
					<input type="hidden" name="deadline" value={createDeadlineValue} />
					<input type="hidden" name="timezoneOffset" value={String(timezoneOffset)} />
				</div>
			</form>
		</section>

		<section class="task-section" data-label="TASK QUEUE">
			{#if data.todos.length > 0}
				<!-- Global tasks (no project) -->
				{#if globalTasks.length > 0}
					<div class="task-group">
						{#if data.projects.length > 0}
							<div class="task-group-header">GLOBAL</div>
						{/if}
						<ul class="todo-list">
							{#each globalTasks as todo (todo.id)}
								{@const taskPomSummary = pomodoroSummary(todo.id)}
								{@const resourceCount = todo.resources?.length ?? 0}
								{@const lastLog = todo.logs?.length ? todo.logs[todo.logs.length - 1] : null}
								{@const totalFocus = todo.totalFocusMs ?? 0}
								<li
									class="todo-item"
									class:done={todo.done}
									class:active={focus?.activeTaskId === todo.id}
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
										{:else if focus?.activeTaskId === todo.id}
											<span class="status-tag active">[FOCUSED]</span>
										{/if}

										<button class="todo-title" onclick={() => { if (!todo.done) focusOnTask(todo.id); openDetail(todo.id); }}>{todo.title}</button>

										{#if todo.deadline}
											<span class="deadline-badge" class:overdue={!todo.done && isOverdue(todo.deadline)}>
												{formatDeadline(todo.deadline)}
											</span>
										{/if}

										<div class="todo-actions">
											{#if !todo.done && focus?.activeTaskId === todo.id}
												<button onclick={() => unfocusTask()}>UNFOCUS</button>
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
														if (focus?.activeTaskId === todo.id) unfocusTask();
													}}
												>DEL</button>
											</form>
										</div>
									</div>

									{#if taskPomSummary || resourceCount > 0 || lastLog || totalFocus > 0}
										<div class="task-meta">
											{#if totalFocus > 0}
												<span class="task-meta-item">{formatDuration(totalFocus)} focused</span>
											{/if}
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
					</div>
				{/if}

				<!-- Project-grouped tasks -->
				{#each projectsWithTasks as project (project.id)}
					{#if project.tasks.length > 0}
						<div class="task-group">
							<div class="task-group-header">{project.name.toUpperCase()}</div>
							<ul class="todo-list">
								{#each project.tasks as todo (todo.id)}
									{@const taskPomSummary = pomodoroSummary(todo.id)}
									{@const resourceCount = todo.resources?.length ?? 0}
									{@const lastLog = todo.logs?.length ? todo.logs[todo.logs.length - 1] : null}
									{@const totalFocus = todo.totalFocusMs ?? 0}
									<li
										class="todo-item"
										class:done={todo.done}
										class:active={focus?.activeTaskId === todo.id}
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
											{:else if focus?.activeTaskId === todo.id}
												<span class="status-tag active">[FOCUSED]</span>
											{/if}

											<button class="todo-title" onclick={() => { if (!todo.done) focusOnTask(todo.id); openDetail(todo.id); }}>{todo.title}</button>

											{#if todo.deadline}
												<span class="deadline-badge" class:overdue={!todo.done && isOverdue(todo.deadline)}>
													{formatDeadline(todo.deadline)}
												</span>
											{/if}

											<div class="todo-actions">
												{#if !todo.done && focus?.activeTaskId === todo.id}
													<button onclick={() => unfocusTask()}>UNFOCUS</button>
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
															if (focus?.activeTaskId === todo.id) unfocusTask();
														}}
													>DEL</button>
												</form>
											</div>
										</div>

										{#if taskPomSummary || resourceCount > 0 || lastLog || totalFocus > 0}
											<div class="task-meta">
												{#if totalFocus > 0}
													<span class="task-meta-item">{formatDuration(totalFocus)} focused</span>
												{/if}
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
						</div>
					{/if}
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

			<!-- Project assignment -->
			{#if data.projects.length > 0}
				<div class="detail-section">
					<div class="detail-section-title">PROJECT</div>
					<form
						class="detail-form"
						method="POST"
						action="?/setTaskProject"
						use:enhance={() => {
							return async ({ update }) => {
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="todoId" value={detailTodo.id} />
						<div class="detail-form-row">
							<select name="projectId" class="project-select">
								<option value="" selected={!detailTodo.projectId}>GLOBAL</option>
								{#each data.projects as p (p.id)}
									<option value={p.id} selected={detailTodo.projectId === p.id}>{p.name.toUpperCase()}</option>
								{/each}
							</select>
							<button type="submit">SET</button>
						</div>
					</form>
				</div>
			{/if}

			<!-- Sessions -->
			{#if detailSessions.length > 0 || (detailTodo.totalFocusMs ?? 0) > 0}
				<div class="detail-section">
					<div class="detail-section-title">SESSIONS</div>
					<div class="session-summary">
						<strong>{formatDuration(detailTodo.totalFocusMs ?? 0)}</strong> across {detailSessions.length} session{detailSessions.length !== 1 ? 's' : ''}
					</div>
					{#if detailSessions.length > 0}
						<div class="session-list">
							{#each detailSessions.slice(-5).reverse() as session (session.id)}
								<div class="session-entry">
									<span class="session-date">{formatSessionDate(session.startedAt)}</span>
									<span class="session-duration">{formatDuration(sessionDuration(session))}</span>
									<span class="session-reason">{session.endReason ?? ''}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Pomodoro time summary -->
			{#if detailPomodoros.length > 0}
				<div class="detail-section">
					<div class="detail-section-title">POMODOROS</div>
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

			<!-- Activity log (read-only, input is in hero focus card) -->
			{#if detailTodo.logs && detailTodo.logs.length > 0}
				<div class="detail-section">
					<div class="detail-section-title">ACTIVITY LOG</div>
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
								<div class="log-text">{@html renderMarkdown(log.text)}</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</aside>
	{/if}
</div>
