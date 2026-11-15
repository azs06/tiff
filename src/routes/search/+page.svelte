<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import TaskList from '$lib/components/TaskList.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Search · TIFF</title></svelte:head>

<header class="view-header">
	<div class="view-title">
		<Icon name="search" size={22} />
		<h1>{data.query ? `“${data.query}”` : 'Search'}</h1>
	</div>
	{#if data.query}
		<div class="view-actions">
			<a
				class="btn ghost"
				href={`/search?q=${encodeURIComponent(data.query)}${data.includeCompleted ? '' : '&completed=1'}`}
			>
				{data.includeCompleted ? 'Hide completed' : 'Include completed'}
			</a>
		</div>
	{/if}
</header>

<form class="row search-page-form" action="/search">
	<input name="q" type="search" value={data.query} placeholder="Search titles and notes" aria-label="Search" />
	{#if data.includeCompleted}<input type="hidden" name="completed" value="1" />{/if}
	<button class="btn">Search</button>
</form>

{#if data.query}
	<TaskList tasks={data.tasks} today={data.today} showProject empty="No matching tasks." />
{/if}
