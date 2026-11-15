<script lang="ts">
	import ProjectView from '$lib/components/ProjectView.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Inbox · TIFF</title></svelte:head>

<ProjectView
	project={data.project}
	tasks={data.tasks}
	showCompleted={data.showCompleted}
	projects={data.projects}
	today={data.today}
	user={data.user}
/>
