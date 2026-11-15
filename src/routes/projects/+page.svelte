<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import { PROJECT_COLORS, PROJECT_COLOR_NAMES } from '$lib/types';
	import { enhanced } from '$lib/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const active = $derived(data.projects.filter((p) => !p.isInbox));
</script>

<svelte:head><title>Projects · TIFF</title></svelte:head>

<header class="view-header">
	<div class="view-title">
		<Icon name="folder" size={22} />
		<h1>Projects</h1>
	</div>
</header>

<form id="new" class="row new-project" method="POST" action="?/createProject" use:enhance={enhanced({ reset: true })}>
	<input name="name" placeholder="New project name" maxlength="120" required aria-label="Project name" />
	<select name="color" aria-label="Color">
		{#each PROJECT_COLOR_NAMES as color (color)}
			<option value={color}>{color}</option>
		{/each}
	</select>
	<button class="btn primary"><Icon name="plus" size={15} />Create</button>
</form>

<ul class="project-list">
	{#each active as project (project.id)}
		<li>
			<a href={`/projects/${project.id}`}>
				<span class="dot" style:background={PROJECT_COLORS[project.color]}></span>
				<span class="project-name">{project.name}</span>
				{#if project.memberCount > 1}
					<span class="shared-badge"><Icon name="users" size={13} />{project.memberCount}</span>
				{/if}
				{#if project.role !== 'owner'}<span class="muted">shared by {project.ownerEmail}</span>{/if}
				<span class="nav-count">{project.openCount}</span>
			</a>
		</li>
	{:else}
		<li class="empty">No projects yet. Create one above.</li>
	{/each}
</ul>

{#if data.archived.length}
	<section class="task-group">
		<header class="group-header"><h2>Archived <span class="count">{data.archived.length}</span></h2></header>
		<ul class="project-list archived">
			{#each data.archived as project (project.id)}
				<li>
					<a href={`/projects/${project.id}`}>
						<span class="dot" style:background={PROJECT_COLORS[project.color]}></span>
						<span class="project-name">{project.name}</span>
					</a>
					{#if project.role === 'owner'}
						<form method="POST" action="?/unarchiveProject" use:enhance={enhanced()}>
							<input type="hidden" name="projectId" value={project.id} />
							<button class="btn ghost">Unarchive</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
