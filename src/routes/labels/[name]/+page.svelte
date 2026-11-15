<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import TaskList from '$lib/components/TaskList.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>@{data.label} · TIFF</title></svelte:head>

<header class="view-header">
	<div class="view-title">
		<Icon name="tag" size={22} />
		<h1>{data.label}</h1>
	</div>
</header>

<TaskList tasks={data.tasks} today={data.today} showProject empty={`No open tasks labelled "${data.label}".`} />
