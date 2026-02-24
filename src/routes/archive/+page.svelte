<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let filter: 'all' | 'tasks' | 'projects' = $state('all');

	let showTasks = $derived(filter === 'all' || filter === 'tasks');
	let showProjects = $derived(filter === 'all' || filter === 'projects');

	let hasArchivedTasks = $derived(data.archivedTodos.length > 0);
	let hasArchivedProjects = $derived(data.archivedProjects.length > 0);
	let hasNothing = $derived(!hasArchivedTasks && !hasArchivedProjects);
</script>

<main class="main-content view-main">
	<header class="main-header view-header">
		<span class="tagline">Archive</span>
	</header>

	<div class="archive-filter">
		<button class:active={filter === 'all'} onclick={() => (filter = 'all')}>ALL</button>
		<button class:active={filter === 'tasks'} onclick={() => (filter = 'tasks')}>TASKS</button>
		<button class:active={filter === 'projects'} onclick={() => (filter = 'projects')}>PROJECTS</button>
	</div>

	{#if hasNothing}
		<section class="view-page">
			<div class="empty">No archived items.</div>
		</section>
	{/if}

	{#if showTasks && hasArchivedTasks}
		<section class="view-page" data-label="ARCHIVED TASKS">
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
		</section>
	{/if}

	{#if showProjects && hasArchivedProjects}
		<section class="view-page" data-label="ARCHIVED PROJECTS">
			<div class="archive-list-page">
				{#each data.archivedProjects as project (project.id)}
					<div class="archive-item">
						<span class="archive-title">{project.name}</span>
						<div class="archive-actions">
							<form method="POST" action="?/unarchiveProject" use:enhance>
								<input type="hidden" name="id" value={project.id} />
								<button type="submit">RESTORE</button>
							</form>
							<form method="POST" action="?/deleteProject" use:enhance>
								<input type="hidden" name="id" value={project.id} />
								<button type="submit" class="btn-danger">DELETE</button>
							</form>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</main>
