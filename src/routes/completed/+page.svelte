<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import TaskList from '$lib/components/TaskList.svelte';
	import { dateFromTimestamp, formatDayHeading } from '$lib/dates';
	import type { Task } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const groups = $derived.by(() => {
		const byDay = new Map<string, Task[]>();
		for (const task of data.tasks) {
			const day = dateFromTimestamp(task.completedAt!, data.user.timezone);
			byDay.set(day, [...(byDay.get(day) ?? []), task]);
		}
		return [...byDay.entries()];
	});
</script>

<svelte:head><title>Completed · TIFF</title></svelte:head>

<header class="view-header">
	<div class="view-title">
		<Icon name="completed" size={22} />
		<h1>Completed</h1>
	</div>
</header>

{#each groups as [day, tasks] (day)}
	<section class="task-group">
		<header class="group-header"><h2>{formatDayHeading(day, data.today)} <span class="count">{tasks.length}</span></h2></header>
		<TaskList {tasks} today={data.today} showProject />
	</section>
{:else}
	<div class="empty-state"><p>No completed tasks yet.</p></div>
{/each}
