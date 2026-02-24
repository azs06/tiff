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

	function formatRelativeTime(isoOrMs: string | number): string {
		const ts = typeof isoOrMs === 'string' ? new Date(isoOrMs).getTime() : isoOrMs;
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
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
			{#if data.hasGithubToken}
				<input type="text" name="repo" placeholder="GitHub repo (optional)" autocomplete="off" />
			{/if}
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
								{#if project.githubRepo && data.githubInfo[project.id]}
									{@const info = data.githubInfo[project.id]}
									<span class="github-badge">
										· {project.githubRepo}{#if info.lastPushedAt && !info.error} · pushed {formatRelativeTime(info.lastPushedAt)}{/if}
									</span>
								{/if}
							</span>
						</a>
						<div class="project-list-actions">
							<form method="POST" action="?/archiveProject" use:enhance>
								<input type="hidden" name="id" value={project.id} />
								<button type="submit" class="btn-danger">ARCHIVE</button>
							</form>
							<form method="POST" action="?/deleteProject" use:enhance>
								<input type="hidden" name="id" value={project.id} />
								<button type="submit" class="btn-danger">DELETE</button>
							</form>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</main>
