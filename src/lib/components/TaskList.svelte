<script lang="ts">
	import { drag } from '$lib/dnd.svelte';
	import type { Task } from '$lib/types';
	import { postAction } from '$lib/ui';
	import TaskItem from './TaskItem.svelte';

	let {
		tasks,
		today,
		showProject = false,
		nest = false,
		reorder = null,
		empty = null
	}: {
		tasks: Task[];
		today: string;
		showProject?: boolean;
		/** Render subtasks indented under their parent when both are in the list. */
		nest?: boolean;
		/** Enables drag-and-drop ordering within a project section. */
		reorder?: { projectId: string; sectionId: string | null } | null;
		empty?: string | null;
	} = $props();

	const ids = $derived(new Set(tasks.map((task) => task.id)));
	const titles = $derived(new Map(tasks.map((task) => [task.id, task.title])));
	const roots = $derived(nest ? tasks.filter((task) => !task.parentId || !ids.has(task.parentId)) : tasks);
	const children = $derived.by(() => {
		const map = new Map<string, Task[]>();
		if (!nest) return map;
		for (const task of tasks) {
			if (task.parentId && ids.has(task.parentId)) {
				map.set(task.parentId, [...(map.get(task.parentId) ?? []), task]);
			}
		}
		return map;
	});

	let dropBefore = $state<string | null>(null);
	let dropAtEnd = $state(false);

	function canDrop() {
		return Boolean(reorder && drag.taskId && drag.projectId === reorder.projectId);
	}

	function onDragStart(event: DragEvent, task: Task) {
		if (!reorder || task.completedAt) return;
		drag.taskId = task.id;
		drag.projectId = reorder.projectId;
		event.dataTransfer?.setData('text/plain', task.id);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function onDragEnd() {
		drag.taskId = null;
		drag.projectId = null;
		dropBefore = null;
		dropAtEnd = false;
	}

	function onDragOver(event: DragEvent, beforeId: string | null) {
		if (!canDrop()) return;
		event.preventDefault();
		event.stopPropagation();
		dropBefore = beforeId;
		dropAtEnd = beforeId === null;
	}

	async function onDrop(event: DragEvent) {
		if (!canDrop() || !reorder) return;
		event.preventDefault();
		event.stopPropagation();
		const moving = drag.taskId!;
		const order = roots.filter((task) => !task.completedAt && task.id !== moving).map((task) => task.id);
		const index = dropBefore ? order.indexOf(dropBefore) : -1;
		order.splice(index === -1 ? order.length : index, 0, moving);
		onDragEnd();
		await postAction('reorderTasks', {
			projectId: reorder.projectId,
			sectionId: reorder.sectionId ?? '',
			ids: order
		});
	}
</script>

<ul
	class="task-list"
	class:drop-end={dropAtEnd}
	ondragover={(event) => onDragOver(event, null)}
	ondragleave={() => (dropAtEnd = false)}
	ondrop={onDrop}
>
	{#each roots as task (task.id)}
		<li
			class:drop-before={dropBefore === task.id}
			class:dragging={drag.taskId === task.id}
			draggable={Boolean(reorder) && !task.completedAt}
			ondragstart={(event) => onDragStart(event, task)}
			ondragend={onDragEnd}
			ondragover={(event) => onDragOver(event, task.id)}
		>
			<TaskItem
				{task}
				{today}
				{showProject}
				draggable={Boolean(reorder) && !task.completedAt}
				showParent={!nest && task.parentId ? (titles.get(task.parentId) ?? null) : null}
			/>
			{#if children.get(task.id)?.length}
				<ul class="task-list subtasks">
					{#each children.get(task.id) ?? [] as child (child.id)}
						<li><TaskItem task={child} {today} {showProject} /></li>
					{/each}
				</ul>
			{/if}
		</li>
	{:else}
		{#if empty}<li class="empty">{empty}</li>{/if}
	{/each}
</ul>
