<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import QuickAdd from '$lib/components/QuickAdd.svelte';
	import TaskList from '$lib/components/TaskList.svelte';
	import { formatDayHeading } from '$lib/dates';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const overdue = $derived(data.tasks.filter((t) => t.dueDate! < data.today));
	const dueToday = $derived(data.tasks.filter((t) => t.dueDate === data.today));
</script>

<svelte:head><title>Today · TIFF</title></svelte:head>

<header class="view-header">
	<div class="view-title">
		<Icon name="today" size={22} />
		<h1>Today</h1>
		<span class="muted">{formatDayHeading(data.today, data.today)}</span>
	</div>
</header>

{#if overdue.length}
	<section class="task-group">
		<header class="group-header"><h2 class="overdue">Overdue <span class="count">{overdue.length}</span></h2></header>
		<TaskList tasks={overdue} today={data.today} showProject />
	</section>
{/if}

<section class="task-group">
	{#if overdue.length}
		<header class="group-header"><h2>Today <span class="count">{dueToday.length}</span></h2></header>
	{/if}
	<TaskList tasks={dueToday} today={data.today} showProject />
	<QuickAdd projects={data.projects} today={data.today} dueDate={data.today} />
</section>

{#if data.tasks.length === 0}
	<div class="empty-state">
		<p>Nothing due today. Enjoy it.</p>
	</div>
{/if}
