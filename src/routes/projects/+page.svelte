<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function activeTaskCount(projectId: string): number {
		return data.todos.filter((t) => t.projectId === projectId && !t.done).length;
	}

	function totalTaskCount(projectId: string): number {
		return data.todos.filter((t) => t.projectId === projectId).length;
	}
</script>

<main class="main-content view-main">
	<header class="main-header view-header">
		<span class="tagline">Project Hub</span>
	</header>

	<section class="view-page" data-label="NEW PROJECT">
		<form
			class="project-create-form"
			method="POST"
			action="?/createProject"
			use:enhance={() => {
				return async ({ update }) => {
					await update({ reset: true });
				};
			}}
		>
			<input type="text" name="name" placeholder="Project name" required autocomplete="off" />
			<button type="submit">ADD</button>
		</form>
	</section>

	<section class="view-page" data-label="PROJECTS">
		{#if data.projects.length === 0}
			<div class="empty">No projects yet.</div>
		{:else}
			<div class="project-list" aria-label="Projects">
				{#each data.projects as project (project.id)}
					<div class="project-list-item">
						<a class="project-list-trigger" href={`/projects/${project.id}`}>
							<span class="project-list-name">{project.name}</span>
							<span class="project-list-meta">
								{activeTaskCount(project.id)} active · {totalTaskCount(project.id)} total
							</span>
						</a>
						<form class="project-list-delete" method="POST" action="?/deleteProject" use:enhance>
							<input type="hidden" name="id" value={project.id} />
							<button type="submit" class="btn-danger">DELETE</button>
						</form>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</main>
