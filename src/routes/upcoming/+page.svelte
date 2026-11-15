<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import QuickAdd from '$lib/components/QuickAdd.svelte';
	import TaskList from '$lib/components/TaskList.svelte';
	import { addDays, formatDayHeading } from '$lib/dates';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const overdue = $derived(data.tasks.filter((t) => t.dueDate! < data.today));
	const days = $derived(
		Array.from({ length: data.days }, (_, i) => {
			const date = addDays(data.today, i);
			return { date, tasks: data.tasks.filter((t) => t.dueDate === date) };
		})
	);
</script>

<svelte:head><title>Upcoming · TIFF</title></svelte:head>

<header class="view-header">
	<div class="view-title">
		<Icon name="upcoming" size={22} />
		<h1>Upcoming</h1>
	</div>
</header>

{#if overdue.length}
	<section class="task-group">
		<header class="group-header"><h2 class="overdue">Overdue <span class="count">{overdue.length}</span></h2></header>
		<TaskList tasks={overdue} today={data.today} showProject />
	</section>
{/if}

{#each days as day (day.date)}
	<section class="task-group day-group">
		<header class="group-header">
			<h2>{formatDayHeading(day.date, data.today)} {#if day.tasks.length}<span class="count">{day.tasks.length}</span>{/if}</h2>
		</header>
		<TaskList tasks={day.tasks} today={data.today} showProject />
		<QuickAdd projects={data.projects} today={data.today} dueDate={day.date} />
	</section>
{/each}
