<script lang="ts">
	import type { FocusSession } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let todo = $derived(data.todos.find((entry) => entry.id === data.taskId && !entry.projectId) ?? null);

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

	function formatTimestamp(ms: number): string {
		const d = new Date(ms);
		const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
		const month = months[d.getMonth()];
		const day = d.getDate();
		const year = d.getFullYear();
		const h = d.getHours();
		const m = d.getMinutes();
		return `${month} ${day}, ${year} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	}

	function isOverdue(ms: number): boolean {
		return Date.now() > ms;
	}

	function formatDuration(ms: number): string {
		const totalMin = Math.round(ms / 60_000);
		if (totalMin < 60) return `${totalMin}m`;
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	function getTaskSessions(taskId: string): FocusSession[] {
		return data.sessions.filter((session) => session.taskId === taskId && session.endedAt);
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
</script>

<main class="main-content view-main">
	<header class="main-header view-header">
		<span class="tagline">Task Details</span>
	</header>

	<section class="view-page" data-label="INBOX TASK">
		{#if !todo}
			<div class="empty">Task not found in inbox. <a href="/inbox">Back to inbox</a>.</div>
		{:else}
			{@const detailSessions = getTaskSessions(todo.id)}
			<article class="project-card inbox-task-detail-card" class:done={todo.done}>
				<div class="project-card-header project-detail-top">
					<div class="project-title-block">
						<a class="project-back-link" href="/inbox">← Back to inbox</a>
						<h2>{todo.title}</h2>
						<div class="project-card-meta">
							<span>{todo.done ? 'DONE' : 'ACTIVE'}</span>
							<span>Created {formatTimestamp(todo.createdAt)}</span>
						</div>
					</div>
					<span class="project-task-state">{todo.done ? 'DONE' : 'ACTIVE'}</span>
				</div>

				<div class="project-card-section">
					<div class="sidebar-panel-title">DETAIL</div>
					{#if todo.detail}
						<p class="inbox-task-detail-body">{todo.detail}</p>
					{:else}
						<div class="settings-hint">No extra details for this task.</div>
					{/if}
				</div>

				<div class="project-card-section">
					<div class="sidebar-panel-title">META</div>
					<dl class="inbox-task-meta-list">
						<div class="inbox-task-meta-item">
							<dt>Status</dt>
							<dd>{todo.done ? 'Done' : 'Active'}</dd>
						</div>
						<div class="inbox-task-meta-item">
							<dt>Created</dt>
							<dd>{formatTimestamp(todo.createdAt)}</dd>
						</div>
						<div class="inbox-task-meta-item">
							<dt>Deadline</dt>
							<dd class:overdue={Boolean(todo.deadline && !todo.done && isOverdue(todo.deadline))}>
								{todo.deadline ? formatDeadline(todo.deadline) : 'None'}
							</dd>
						</div>
					</dl>
				</div>

				<div class="project-card-section">
					<div class="sidebar-panel-title">SESSIONS</div>
					{#if detailSessions.length > 0 || (todo.totalFocusMs ?? 0) > 0}
						<div class="session-summary">
							<strong>{formatDuration(todo.totalFocusMs ?? 0)}</strong>
							across {detailSessions.length} session{detailSessions.length !== 1 ? 's' : ''}
						</div>
						{#if detailSessions.length > 0}
							<div class="session-list">
								{#each detailSessions.slice().reverse() as session (session.id)}
									<div class="session-entry">
										<span class="session-date">{formatSessionDate(session.startedAt)}</span>
										<span class="session-duration">{formatDuration(sessionDuration(session))}</span>
										<span class="session-reason">{session.endReason ?? ''}</span>
									</div>
								{/each}
							</div>
						{/if}
					{:else}
						<div class="settings-hint">No focus sessions recorded for this task yet.</div>
					{/if}
				</div>

				<div class="project-card-section">
					<div class="sidebar-panel-title">ACTIVITY LOG</div>
					{#if todo.logs && todo.logs.length > 0}
						<div class="log-list">
							{#each [...todo.logs].reverse() as log (log.id)}
								<div class="log-entry">
									<div class="log-entry-header">
										<span class="log-time">{relativeTime(log.createdAt)}</span>
									</div>
									<div class="log-text">
										{@html renderMarkdown(log.text)}
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="settings-hint">No logs yet for this task.</div>
					{/if}
				</div>
			</article>
		{/if}
	</section>
</main>
