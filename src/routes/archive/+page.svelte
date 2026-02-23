<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<main class="main-content view-main">
	<header class="main-header view-header">
		<span class="tagline">Archive</span>
	</header>

	<section class="view-page" data-label="ARCHIVED TASKS">
		{#if data.archivedTodos.length > 0}
			<div class="archive-list-page">
				{#each data.archivedTodos as todo (todo.id)}
					<div class="archive-item">
						<span class="archive-title">{todo.title}</span>
						<div class="archive-actions">
							<form method="POST" action="?/unarchive" use:enhance>
								<input type="hidden" name="id" value={todo.id} />
								<button type="submit">RESTORE</button>
							</form>
							<form method="POST" action="?/delete" use:enhance>
								<input type="hidden" name="id" value={todo.id} />
								<button type="submit" class="btn-danger">DELETE</button>
							</form>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="empty">No archived tasks.</div>
		{/if}
	</section>
</main>
