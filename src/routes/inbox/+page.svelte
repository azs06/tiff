<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let timezoneOffset = $state(0);
	let editingTaskId = $state<string | null>(null);
	let editTitle = $state('');
	let editDetail = $state('');
	let editDeadlineChoice = $state<'none' | 'today' | 'tomorrow' | 'custom'>('none');
	let editCustomDeadline = $state('');

	$effect(() => {
		timezoneOffset = new Date().getTimezoneOffset();
	});

	let inboxTodos = $derived(() =>
		data.todos
			.filter((todo) => !todo.projectId)
			.slice()
			.sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt)
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

	function startEditing(todoId: string) {
		const todo = inboxTodos().find((item) => item.id === todoId);
		if (!todo) return;

		editingTaskId = todoId;
		editTitle = todo.title;
		editDetail = todo.detail ?? '';
		editDeadlineChoice = todo.deadline ? 'custom' : 'none';
		editCustomDeadline = todo.deadline
			? new Date(todo.deadline - timezoneOffset * 60_000).toISOString().slice(0, 16)
			: '';
	}

	function stopEditing() {
		editingTaskId = null;
	}

	$effect(() => {
		if (editingTaskId && !inboxTodos().some((todo) => todo.id === editingTaskId)) {
			editingTaskId = null;
		}
	});
</script>

<main class="main-content view-main">
	<header class="main-header view-header">
		<span class="tagline">Inbox</span>
	</header>

	<section class="view-page" data-label="INBOX TASKS">
		{#if inboxTodos().length > 0}
			<div class="inbox-list-page">
				{#each inboxTodos() as todo (todo.id)}
					<article class="inbox-task-item" class:done={todo.done}>
						<div class="inbox-task-header">
							<div class="inbox-task-main">
								<form method="POST" action="?/toggle" class="toggle-form" use:enhance>
									<input type="hidden" name="id" value={todo.id} />
									<button type="submit" class="toggle-btn" class:checked={todo.done}>
										{todo.done ? '✓' : ''}
									</button>
								</form>

								<div class="inbox-task-copy">
									<div class="inbox-task-title-row">
										<a class="inbox-task-title" href={`/inbox/${todo.id}`}>{todo.title}</a>
										{#if todo.deadline}
											<span class="deadline-badge" class:overdue={!todo.done && isOverdue(todo.deadline)}>
												{formatDeadline(todo.deadline)}
											</span>
										{/if}
									</div>
									{#if todo.detail}
										<p class="inbox-task-detail">{todo.detail}</p>
									{/if}
								</div>
							</div>

							<div class="inbox-task-actions">
								<button
									type="button"
									class="btn-edit"
									onclick={() => (editingTaskId === todo.id ? stopEditing() : startEditing(todo.id))}
								>
									{editingTaskId === todo.id ? 'CLOSE' : 'EDIT'}
								</button>
								{#if todo.done}
									<form method="POST" action="?/archive" use:enhance>
										<input type="hidden" name="id" value={todo.id} />
										<button type="submit">ARCHIVE</button>
									</form>
								{/if}
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="id" value={todo.id} />
									<button type="submit" class="btn-danger">DELETE</button>
								</form>
							</div>
						</div>

						{#if editingTaskId === todo.id}
							<div class="inbox-task-editor">
								<form
									method="POST"
									action="?/update"
									class="detail-form"
									use:enhance={() => {
										return async ({ result, update }) => {
											await update({ reset: false });
											if (result.type === 'success') stopEditing();
										};
									}}
								>
									<input type="hidden" name="id" value={todo.id} />
									<input type="text" name="title" placeholder="Task title" required bind:value={editTitle} />
									<textarea name="detail" rows="3" placeholder="Details (optional)" bind:value={editDetail}></textarea>

									<div class="deadline-row">
										<span class="deadline-label">DEADLINE:</span>
										<button
											type="button"
											class="deadline-opt"
											class:selected={editDeadlineChoice === 'none'}
											onclick={() => (editDeadlineChoice = 'none')}
										>
											NONE
										</button>
										<button
											type="button"
											class="deadline-opt"
											class:selected={editDeadlineChoice === 'today'}
											onclick={() => (editDeadlineChoice = 'today')}
										>
											TODAY
										</button>
										<button
											type="button"
											class="deadline-opt"
											class:selected={editDeadlineChoice === 'tomorrow'}
											onclick={() => (editDeadlineChoice = 'tomorrow')}
										>
											TOMORROW
										</button>
										<button
											type="button"
											class="deadline-opt"
											class:selected={editDeadlineChoice === 'custom'}
											onclick={() => (editDeadlineChoice = 'custom')}
										>
											CUSTOM
										</button>
										{#if editDeadlineChoice === 'custom'}
											<input type="datetime-local" class="deadline-datetime" bind:value={editCustomDeadline} />
										{/if}
									</div>

									<input type="hidden" name="deadline" value={editDeadlineValue} />
									<input type="hidden" name="timezoneOffset" value={String(timezoneOffset)} />
									<button type="submit" class="btn-save">SAVE CHANGES</button>
								</form>

								{#if data.projects.length > 0}
									<form class="project-inline-form inbox-project-form" method="POST" action="?/setTaskProject" use:enhance>
										<input type="hidden" name="todoId" value={todo.id} />
										<span class="project-label">PROJECT:</span>
										<select name="projectId" class="project-select">
											<option value="">INBOX</option>
											{#each data.projects as project (project.id)}
												<option value={project.id}>{project.name.toUpperCase()}</option>
											{/each}
										</select>
										<button type="submit">SET</button>
									</form>
								{:else}
									<div class="settings-hint">No projects yet. Create one in Projects to move this task.</div>
								{/if}
							</div>
						{/if}
					</article>
				{/each}
			</div>
		{:else}
			<div class="empty">No inbox tasks. Add a task without a project.</div>
		{/if}
	</section>
</main>
