<script lang="ts">
	import { page } from '$app/state';
	import { dueStatus, formatDue } from '$lib/dates';
	import { PROJECT_COLORS, type Task } from '$lib/types';
	import { initials, taskHref, toggleTask } from '$lib/ui';
	import Icon from './Icon.svelte';

	let {
		task,
		today,
		showProject = false,
		showParent = null,
		draggable = false
	}: {
		task: Task;
		today: string;
		showProject?: boolean;
		showParent?: string | null;
		draggable?: boolean;
	} = $props();

	let pending = $state(false);
	const done = $derived(Boolean(task.completedAt));
	const status = $derived(task.dueDate ? dueStatus(task.dueDate, today) : null);
	const active = $derived(page.url.searchParams.get('task') === task.id);

	async function onToggle(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;
		pending = true;
		try {
			await toggleTask(task);
		} finally {
			pending = false;
		}
	}
</script>

<div class="task" class:done class:pending class:active data-priority={task.priority}>
	{#if draggable}
		<span class="drag-handle" title="Drag to reorder"><Icon name="grip" size={14} /></span>
	{/if}
	<form method="POST" action={done ? '?/reopenTask' : '?/completeTask'} onsubmit={onToggle}>
		<input type="hidden" name="taskId" value={task.id} />
		<button
			class="check"
			class:checked={done || pending}
			aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
		>
			<Icon name="check" size={12} />
		</button>
	</form>

	<a class="task-body" href={taskHref(page.url, task.id)} data-sveltekit-noscroll data-sveltekit-keepfocus>
		<span class="task-title">{task.title}</span>
		{#if task.notes}
			<span class="task-notes">{task.notes.split('\n')[0]}</span>
		{/if}
		<span class="task-meta">
			{#if task.dueDate}
				<span class="meta due due-{status}">
					<Icon name="today" size={13} />
					{formatDue(task.dueDate, task.dueTime, today)}
					{#if task.recurrence}<span title={task.recurrence}><Icon name="repeat" size={12} /></span>{/if}
				</span>
			{/if}
			{#if task.subtaskCount}
				<span class="meta"><Icon name="subtask" size={13} />{task.subtaskDoneCount}/{task.subtaskCount}</span>
			{/if}
			{#if task.commentCount}
				<span class="meta"><Icon name="comment" size={13} />{task.commentCount}</span>
			{/if}
			{#each task.labels as label (label)}
				<span class="meta label"><Icon name="tag" size={12} />{label}</span>
			{/each}
			{#if showParent}
				<span class="meta parent"><Icon name="subtask" size={12} />{showParent}</span>
			{/if}
			{#if showProject}
				<span class="meta project">
					<span class="dot" style:background={PROJECT_COLORS[task.projectColor]}></span>
					{task.projectName}
				</span>
			{/if}
		</span>
	</a>

	{#if task.assigneeEmail}
		<span class="avatar" title={`Assigned to ${task.assigneeEmail}`}>{initials(task.assigneeEmail)}</span>
	{/if}
</div>
