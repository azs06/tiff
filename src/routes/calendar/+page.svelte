<script lang="ts">
	import type { PageData } from './$types';
	import Calendar from '$lib/Calendar.svelte';

	let { data }: { data: PageData } = $props();
</script>

<main class="main-content view-main">
	<header class="main-header view-header">
		<span class="tagline">Calendar</span>
	</header>

	<section class="view-page" data-label="ACTIVITY">
		<div class="calendar-page-card">
			<Calendar pomodoroLogs={data.pomodoroLogs} todos={data.todos} />
		</div>
	</section>
</main>
