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
			<div class="project-cards">
				{#each data.projects as project (project.id)}
					<article class="project-card">
						<div class="project-card-header">
							<div>
								<h2>{project.name}</h2>
								<div class="project-card-meta">
									<span>{activeTaskCount(project.id)} active</span>
									<span>{totalTaskCount(project.id)} total</span>
								</div>
							</div>
							<form method="POST" action="?/deleteProject" use:enhance>
								<input type="hidden" name="id" value={project.id} />
								<button type="submit" class="btn-danger">DELETE</button>
							</form>
						</div>

						<div class="project-card-section">
							<div class="sidebar-panel-title">DETAILS</div>
							<form method="POST" action="?/updateProject" class="detail-form" use:enhance>
								<input type="hidden" name="id" value={project.id} />
								<textarea name="detail" rows="4" placeholder="Project details...">{project.detail ?? ''}</textarea>
								<button type="submit" class="btn-save">SAVE DETAILS</button>
							</form>
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
				{/each}
			</div>
		{/if}
	</section>
</main>
