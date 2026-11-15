<script lang="ts">
	import ProjectView from '$lib/components/ProjectView.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.project.name} · TIFF</title></svelte:head>

{#key data.project.id}
	<ProjectView
		project={data.project}
		tasks={data.tasks}
		showCompleted={data.showCompleted}
		projects={data.projects}
		today={data.today}
		user={data.user}
	/>
{/key}
