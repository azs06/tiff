<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDue } from '$lib/dates';
	import { parseQuickAdd } from '$lib/quickadd';
	import { PROJECT_COLORS, type ProjectSummary } from '$lib/types';
	import { enhanced } from '$lib/ui';
	import Icon from './Icon.svelte';

	let {
		projects,
		today,
		projectId = null,
		sectionId = null,
		parentId = null,
		dueDate = null,
		open = $bindable(false),
		alwaysOpen = false,
		label = 'Add task',
		placeholder = 'e.g. Pay rent every month p1 #Home @bills',
		onclose
	}: {
		projects: ProjectSummary[];
		today: string;
		projectId?: string | null;
		sectionId?: string | null;
		parentId?: string | null;
		dueDate?: string | null;
		open?: boolean;
		alwaysOpen?: boolean;
		label?: string;
		placeholder?: string;
		onclose?: () => void;
	} = $props();

	let text = $state('');
	let submitting = $state(false);
	let input: HTMLInputElement | null = $state(null);

	const parsed = $derived(text.trim() ? parseQuickAdd(text, { today, projects }) : null);
	const defaultProject = $derived(projects.find((p) => p.id === projectId) ?? projects.find((p) => p.isInbox));
	const targetProject = $derived(
		parsed?.projectId ? projects.find((p) => p.id === parsed.projectId) : defaultProject
	);
	const effectiveDue = $derived(parsed?.dueDate ?? (parsed?.recurrence ? null : dueDate));

	$effect(() => {
		if (open && !alwaysOpen && input) input.focus();
	});

	function close() {
		text = '';
		open = false;
		onclose?.();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			close();
		}
	}
</script>

{#if open || alwaysOpen}
	<form
		class="quick-add"
		method="POST"
		action="?/quickAdd"
		use:enhance={enhanced({
			onSubmit: () => (submitting = true),
			onSuccess: () => {
				text = '';
				input?.focus();
			},
			onSettled: () => (submitting = false)
		})}
	>
		<input type="hidden" name="projectId" value={projectId ?? ''} />
		<input type="hidden" name="sectionId" value={sectionId ?? ''} />
		<input type="hidden" name="parentId" value={parentId ?? ''} />
		<input type="hidden" name="dueDate" value={dueDate ?? ''} />
		<input
			bind:this={input}
			bind:value={text}
			name="text"
			{placeholder}
			autocomplete="off"
			maxlength="1000"
			aria-label="Task"
			onkeydown={onKeydown}
		/>

		<div class="quick-add-footer">
			<div class="chips" aria-live="polite">
				{#if !parentId && targetProject}
					<span class="chip">
						<span class="dot" style:background={PROJECT_COLORS[targetProject.color]}></span>
						{targetProject.name}
					</span>
				{/if}
				{#if effectiveDue}
					<span class="chip chip-date">
						<Icon name="today" size={12} />{formatDue(effectiveDue, parsed?.dueTime ?? null, today)}
					</span>
				{/if}
				{#if parsed?.recurrence}
					<span class="chip chip-date"><Icon name="repeat" size={12} />{parsed.recurrence}</span>
				{/if}
				{#if parsed?.priority}
					<span class="chip p{parsed.priority}"><Icon name="flag" size={12} />P{parsed.priority}</span>
				{/if}
				{#each parsed?.labels ?? [] as name (name)}
					<span class="chip"><Icon name="tag" size={12} />{name}</span>
				{/each}
				{#if parsed?.unknownProject}
					<span class="chip chip-warn">No project "#{parsed.unknownProject}"</span>
				{/if}
			</div>
			<div class="quick-add-actions">
				{#if !alwaysOpen}
					<button type="button" class="btn ghost" onclick={close}>Cancel</button>
				{/if}
				<button class="btn primary" disabled={!parsed?.title || submitting}>Add task</button>
			</div>
		</div>
	</form>
{:else}
	<button type="button" class="add-task-button" onclick={() => (open = true)}>
		<span class="plus"><Icon name="plus" size={16} /></span>{label}
	</button>
{/if}
