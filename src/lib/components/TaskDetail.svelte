<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { addDays, dueStatus, formatDue, nextWeekdayOnOrAfter } from '$lib/dates';
	import { parseDueString } from '$lib/quickadd';
	import { toast } from '$lib/toast.svelte';
	import { PROJECT_COLORS, type ProjectSummary, type TaskDetail, type User } from '$lib/types';
	import { enhanced, initials, openTask, projectHref, relativeTime, taskHref, toggleTask } from '$lib/ui';
	import Icon from './Icon.svelte';
	import QuickAdd from './QuickAdd.svelte';
	import TaskList from './TaskList.svelte';

	let {
		detail,
		projects,
		today,
		user
	}: { detail: TaskDetail; projects: ProjectSummary[]; today: string; user: User } = $props();

	const task = $derived(detail.task);
	const done = $derived(Boolean(task.completedAt));
	const section = $derived(detail.sections.find((s) => s.id === task.sectionId) ?? null);
	const moveTarget = $derived(task.sectionId ? `${task.projectId}:${task.sectionId}` : task.projectId);
	const openSubtasks = $derived(detail.subtasks.filter((s) => !s.completedAt));
	const doneSubtasks = $derived(detail.subtasks.filter((s) => s.completedAt));

	let dueText = $state('');
	let addingSubtask = $state(false);
	let showDoneSubtasks = $state(false);
	let scheduleForm: HTMLFormElement | null = $state(null);
	let dateInput: HTMLInputElement | null = $state(null);
	let timeInput: HTMLInputElement | null = $state(null);
	let recurrenceInput: HTMLInputElement | null = $state(null);
	let dialog: HTMLElement | null = $state(null);

	$effect(() => {
		dialog?.focus();
	});

	function close() {
		openTask(page.url, null);
	}

	function submitOnChange(event: Event) {
		(event.currentTarget as HTMLFormElement).requestSubmit();
	}

	function setSchedule(date: string | null, time?: string | null, recurrence?: string | null) {
		if (!scheduleForm || !dateInput || !timeInput || !recurrenceInput) return;
		dateInput.value = date ?? '';
		if (time !== undefined) timeInput.value = time ?? '';
		if (recurrence !== undefined) recurrenceInput.value = recurrence ?? '';
		if (!date) {
			timeInput.value = '';
			recurrenceInput.value = '';
		}
		scheduleForm.requestSubmit();
	}

	function applyDueText(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		const parsed = parseDueString(dueText, today);
		if (!parsed || (!parsed.dueDate && !parsed.recurrence)) {
			toast(`Could not understand "${dueText}"`, { kind: 'error' });
			return;
		}
		setSchedule(parsed.dueDate, parsed.dueTime, parsed.recurrence);
		dueText = '';
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') close();
	}

	const presets = $derived([
		{ label: 'Today', date: today },
		{ label: 'Tomorrow', date: addDays(today, 1) },
		{ label: 'Weekend', date: nextWeekdayOnOrAfter(today, 6) },
		{ label: 'Next week', date: nextWeekdayOnOrAfter(addDays(today, 1), 1) }
	]);
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop" onclick={close} role="presentation"></div>
<div
	class="modal task-detail"
	role="dialog"
	aria-modal="true"
	aria-labelledby="task-detail-title"
	tabindex="-1"
	bind:this={dialog}
>
	<header class="modal-header">
		<nav class="breadcrumb">
			<a href={projectHref(task.projectId, user.inboxProjectId)}>
				<span class="dot" style:background={PROJECT_COLORS[task.projectColor]}></span>{task.projectName}
			</a>
			{#if section}<span>/</span><span>{section.name}</span>{/if}
			{#if detail.parent}
				<span>/</span>
				<a href={taskHref(page.url, detail.parent.id)} data-sveltekit-noscroll>{detail.parent.title}</a>
			{/if}
		</nav>
		<button class="icon-btn" onclick={close} aria-label="Close task"><Icon name="close" /></button>
	</header>

	<div class="task-detail-body">
		<div class="task-detail-main">
			<div class="title-row" data-priority={task.priority}>
				<button
					class="check"
					class:checked={done}
					onclick={() => toggleTask(task)}
					aria-label={done ? 'Mark as not done' : 'Complete task'}
				>
					<Icon name="check" size={12} />
				</button>
				<form
					class="title-form"
					method="POST"
					action="?/updateTask"
					use:enhance={enhanced()}
					onchange={submitOnChange}
				>
					<input type="hidden" name="taskId" value={task.id} />
					<input
						id="task-detail-title"
						class="title-input"
						class:done
						name="title"
						value={task.title}
						maxlength="500"
						required
						aria-label="Task title"
					/>
					<textarea name="notes" placeholder="Notes" rows="3" value={task.notes ?? ''} aria-label="Notes"
					></textarea>
				</form>
			</div>

			{#if task.recurrence && task.dueDate}
				<p class="hint"><Icon name="repeat" size={13} /> Repeats {task.recurrence}. Completing it moves it to the next date.</p>
			{/if}

			{#if !task.parentId}
				<section class="detail-section">
					<h3>
						Subtasks
						{#if detail.subtasks.length}<span class="count">{doneSubtasks.length}/{detail.subtasks.length}</span>{/if}
					</h3>
					<TaskList tasks={openSubtasks} {today} />
					{#if doneSubtasks.length}
						<button class="link-btn" onclick={() => (showDoneSubtasks = !showDoneSubtasks)}>
							{showDoneSubtasks ? 'Hide' : 'Show'} {doneSubtasks.length} completed
						</button>
						{#if showDoneSubtasks}<TaskList tasks={doneSubtasks} {today} />{/if}
					{/if}
					<QuickAdd
						{projects}
						{today}
						parentId={task.id}
						bind:open={addingSubtask}
						label="Add subtask"
						placeholder="Subtask, e.g. Book tickets tomorrow"
					/>
				</section>
			{/if}

			<section class="detail-section">
				<h3>Comments {#if detail.comments.length}<span class="count">{detail.comments.length}</span>{/if}</h3>
				<ul class="comments">
					{#each detail.comments as comment (comment.id)}
						<li class="comment">
							<span class="avatar">{initials(comment.authorEmail)}</span>
							<div class="comment-body">
								<div class="comment-meta">
									<strong>{comment.authorEmail === user.email ? 'You' : comment.authorEmail}</strong>
									<span>{relativeTime(comment.createdAt)}</span>
									{#if comment.authorEmail === user.email}
										<form method="POST" action="?/deleteComment" use:enhance={enhanced()}>
											<input type="hidden" name="commentId" value={comment.id} />
											<button class="link-btn danger">Delete</button>
										</form>
									{/if}
								</div>
								<p>{comment.body}</p>
							</div>
						</li>
					{/each}
				</ul>
				<form class="comment-form" method="POST" action="?/addComment" use:enhance={enhanced({ reset: true })}>
					<input type="hidden" name="taskId" value={task.id} />
					<textarea name="body" rows="2" placeholder="Add a comment" required maxlength="10000"></textarea>
					<button class="btn">Comment</button>
				</form>
			</section>
		</div>

		<aside class="task-detail-side">
			<form method="POST" action="?/moveTask" use:enhance={enhanced()} onchange={submitOnChange}>
				<input type="hidden" name="taskId" value={task.id} />
				<label class="field">
					<span>Project</span>
					<select name="target" value={moveTarget}>
						{#each projects as project (project.id)}
							<option value={project.id}>{project.name}</option>
							{#if project.id === task.projectId}
								{#each detail.sections as s (s.id)}
									<option value={`${project.id}:${s.id}`}>&nbsp;&nbsp;› {s.name}</option>
								{/each}
							{/if}
						{/each}
					</select>
				</label>
			</form>

			<form
				method="POST"
				action="?/updateTask"
				bind:this={scheduleForm}
				use:enhance={enhanced()}
				onchange={submitOnChange}
			>
				<input type="hidden" name="taskId" value={task.id} />
				<div class="field">
					<span>Due date</span>
					{#if task.dueDate}
						<div class="due-summary due-{dueStatus(task.dueDate, today)}">
							<Icon name="today" size={14} />{formatDue(task.dueDate, task.dueTime, today)}
						</div>
					{/if}
					<input
						class="due-text"
						bind:value={dueText}
						placeholder="Type a date: fri 5pm, every weekday"
						onkeydown={applyDueText}
						onchange={(event) => event.stopPropagation()}
						aria-label="Due date in words"
					/>
					<div class="preset-row">
						{#each presets as preset (preset.label)}
							<button type="button" class="chip-btn" onclick={() => setSchedule(preset.date)}>{preset.label}</button>
						{/each}
						{#if task.dueDate}
							<button type="button" class="chip-btn" onclick={() => setSchedule(null)}>No date</button>
						{/if}
					</div>
					<div class="row">
						<input type="date" name="dueDate" value={task.dueDate ?? ''} bind:this={dateInput} aria-label="Due date" />
						<input type="time" name="dueTime" value={task.dueTime ?? ''} bind:this={timeInput} aria-label="Due time" />
					</div>
					<input
						name="recurrence"
						value={task.recurrence ?? ''}
						placeholder="Repeat: every monday"
						bind:this={recurrenceInput}
						aria-label="Repeat"
					/>
				</div>
			</form>

			<form method="POST" action="?/updateTask" use:enhance={enhanced()} onchange={submitOnChange}>
				<input type="hidden" name="taskId" value={task.id} />
				<label class="field">
					<span>Priority</span>
					<select name="priority" value={String(task.priority)}>
						<option value="1">P1 · Urgent</option>
						<option value="2">P2 · High</option>
						<option value="3">P3 · Medium</option>
						<option value="4">P4 · None</option>
					</select>
				</label>
			</form>

			<form method="POST" action="?/updateTask" use:enhance={enhanced()} onchange={submitOnChange}>
				<input type="hidden" name="taskId" value={task.id} />
				<label class="field">
					<span>Labels</span>
					<input name="labels" value={task.labels.join(', ')} placeholder="work, errands" />
				</label>
			</form>

			{#if detail.members.length > 1}
				<form method="POST" action="?/updateTask" use:enhance={enhanced()} onchange={submitOnChange}>
					<input type="hidden" name="taskId" value={task.id} />
					<label class="field">
						<span>Assignee</span>
						<select name="assigneeEmail" value={task.assigneeEmail ?? ''}>
							<option value="">Unassigned</option>
							{#each detail.members as member (member.email)}
								<option value={member.email}>{member.email === user.email ? `${member.email} (you)` : member.email}</option>
							{/each}
						</select>
					</label>
				</form>
			{/if}

			<p class="meta-line">
				Added by {task.createdBy === user.email ? 'you' : task.createdBy}, {relativeTime(task.createdAt)}
				{#if task.completedAt && task.completedBy}
					<br />Completed by {task.completedBy === user.email ? 'you' : task.completedBy}, {relativeTime(task.completedAt)}
				{/if}
			</p>

			<form
				method="POST"
				action="?/deleteTask"
				use:enhance={({ cancel }) => {
					if (!confirm(`Delete "${task.title}"${task.subtaskCount ? ' and its subtasks' : ''}?`)) return cancel();
					return async ({ result, update }) => {
						if (result.type === 'success') {
							toast(`Deleted "${task.title}"`);
							await update();
							await openTask(page.url, null);
						} else {
							if (result.type === 'failure') toast(String(result.data?.error ?? 'Delete failed'), { kind: 'error' });
							await update();
						}
					};
				}}
			>
				<input type="hidden" name="taskId" value={task.id} />
				<button class="btn danger-outline"><Icon name="trash" size={15} /> Delete task</button>
			</form>
		</aside>
	</div>
</div>
