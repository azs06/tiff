<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let project = $derived(data.projects.find((entry) => entry.id === data.projectId) ?? null);
	let projectTodos = $derived(
		project
			? data.todos
					.filter((todo) => todo.projectId === project.id)
					.sort((a, b) => Number(a.done) - Number(b.done))
			: []
	);

	function getDomainLabel(url: string): string {
		try {
			return new URL(url).hostname;
		} catch {
			return 'Link';
		}
	}

	function formatSize(bytes: number | undefined): string {
		if (!bytes || bytes <= 0) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
		return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
	}
</script>

<main class="main-content view-main">
	<header class="main-header view-header">
		<span class="tagline">Project Details</span>
	</header>

	<section class="view-page" data-label="PROJECT">
		{#if !project}
			<div class="empty">Project not found. <a href="/projects">Back to project list</a>.</div>
		{:else}
			<article class="project-card project-detail-card">
				<div class="project-card-header project-detail-top">
					<div class="project-title-block">
						<a class="project-back-link" href="/projects">← Back to projects</a>
						<h2>{project.name}</h2>
						<div class="project-card-meta">
							<span>{projectTodos.filter((todo) => !todo.done).length} active</span>
							<span>{projectTodos.length} total</span>
						</div>
					</div>
					<form
						method="POST"
						action="?/deleteProject"
						use:enhance={() => {
							return async ({ update, result }) => {
								await update();
								if (result.type === 'success') {
									await goto('/projects');
								}
							};
						}}
					>
						<input type="hidden" name="id" value={project.id} />
						<button type="submit" class="btn-danger">DELETE PROJECT</button>
					</form>
				</div>

				<div class="project-card-section">
					<div class="sidebar-panel-title">EDIT</div>
					<form method="POST" action="?/updateProject" class="detail-form" use:enhance>
						<input type="hidden" name="id" value={project.id} />
						<input type="text" name="name" value={project.name} required />
						<textarea name="detail" rows="4" placeholder="Project details...">{project.detail ?? ''}</textarea>
						<button type="submit" class="btn-save">SAVE PROJECT</button>
					</form>
				</div>

				<div class="project-card-section">
					<div class="sidebar-panel-title">TASKS</div>
					{#if projectTodos.length > 0}
						<div class="project-task-list">
							{#each projectTodos as todo (todo.id)}
								<div class="project-task-item" class:done={todo.done}>
									<span class="project-task-state">{todo.done ? 'DONE' : 'ACTIVE'}</span>
									<span class="project-task-title">{todo.title}</span>
								</div>
							{/each}
						</div>
					{:else}
						<div class="settings-hint">No tasks assigned to this project yet.</div>
					{/if}
				</div>

				<div class="project-card-section">
					<div class="sidebar-panel-title">RESOURCES</div>
					{#if project.resources && project.resources.length > 0}
						<div class="resource-list">
							{#each project.resources as resource (resource.id)}
								<div class="resource-item">
									<span class="resource-label">{resource.label || getDomainLabel(resource.url)}</span>
									<a class="resource-url" href={resource.url} target="_blank" rel="noopener noreferrer">{resource.url}</a>
									<form method="POST" action="?/deleteProjectResource" use:enhance>
										<input type="hidden" name="projectId" value={project.id} />
										<input type="hidden" name="resourceId" value={resource.id} />
										<button type="submit" class="resource-delete">✕</button>
									</form>
								</div>
							{/each}
						</div>
					{/if}
					<form
						class="detail-form"
						method="POST"
						action="?/addProjectResource"
						use:enhance={() => {
							return async ({ update }) => {
								await update({ reset: true });
							};
						}}
					>
						<input type="hidden" name="projectId" value={project.id} />
						<input type="url" name="url" placeholder="https://resource-link" required />
						<div class="detail-form-row">
							<input type="text" name="label" placeholder="Label (optional)" />
							<button type="submit">ADD</button>
						</div>
					</form>
				</div>

				<div class="project-card-section">
					<div class="sidebar-panel-title">ATTACHMENTS</div>
					{#if project.attachments && project.attachments.length > 0}
						<div class="resource-list">
							{#each project.attachments as attachment (attachment.id)}
								<div class="resource-item">
									<span class="resource-label">{attachment.name}</span>
									<a class="resource-url" href={attachment.url} target="_blank" rel="noopener noreferrer">
										{attachment.key ? 'Open stored file' : attachment.url}
									</a>
									{#if attachment.size}
										<span class="project-attachment-size">{formatSize(attachment.size)}</span>
									{/if}
									<form method="POST" action="?/deleteProjectAttachment" use:enhance>
										<input type="hidden" name="projectId" value={project.id} />
										<input type="hidden" name="attachmentId" value={attachment.id} />
										<button type="submit" class="resource-delete">✕</button>
									</form>
								</div>
							{/each}
						</div>
					{/if}
					<form
						class="detail-form"
						method="POST"
						enctype="multipart/form-data"
						action="?/addProjectAttachment"
						use:enhance={() => {
							return async ({ update }) => {
								await update({ reset: true });
							};
						}}
					>
						<input type="hidden" name="projectId" value={project.id} />
						<input type="file" name="file" required />
						<div class="detail-form-row">
							<input type="text" name="name" placeholder="Attachment name (optional)" />
							<button type="submit">ATTACH</button>
						</div>
						<div class="settings-hint">Max file size: 25MB</div>
					</form>
				</div>
			</article>
		{/if}
	</section>
</main>
