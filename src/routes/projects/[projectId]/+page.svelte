<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import type { GitHubRepoInfo } from '$lib/types';

	let { data }: { data: PageData } = $props();

	let project = $derived(data.projects.find((entry) => entry.id === data.projectId) ?? null);
	let projectTodos = $derived(
		project
			? data.todos
					.filter((todo) => todo.projectId === project.id)
					.sort((a, b) => Number(a.done) - Number(b.done))
			: []
	);

	let ghInfo: GitHubRepoInfo | undefined = $derived(
		project ? data.githubInfo[project.id] : undefined
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
					<div class="project-detail-actions">
						<form
							method="POST"
							action="?/archiveProject"
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
							<button type="submit" class="btn-danger">ARCHIVE</button>
						</form>
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
							<button type="submit" class="btn-danger">DELETE</button>
						</form>
					</div>
				</div>

				<div class="project-card-section">
					<div class="sidebar-panel-title">EDIT</div>
					<form method="POST" action="?/updateProject" class="detail-form" use:enhance>
						<input type="hidden" name="id" value={project.id} />
						<input type="text" name="name" value={project.name} required />
						<div class="detail-textarea-wrap">
							<textarea name="detail" rows="4" placeholder="Project details...">{project.detail ?? ''}</textarea>
						</div>
						<button type="submit" class="btn-save">SAVE PROJECT</button>
					</form>
				</div>

				<div class="project-card-section">
					<div class="sidebar-panel-title">GITHUB</div>
					{#if !data.hasGithubToken}
						<div class="settings-hint">GitHub integration not configured.</div>
					{:else if !project.githubRepo}
						<form
							class="detail-form"
							method="POST"
							action="?/linkGithub"
							use:enhance={() => {
								return async ({ update }) => {
									await update({ reset: true });
								};
							}}
						>
							<input type="hidden" name="projectId" value={project.id} />
							<input type="text" name="repo" placeholder="owner/repo or GitHub URL" required />
							<button type="submit">LINK REPO</button>
						</form>
					{:else}
						<div class="github-info">
							{#if ghInfo?.error}
								<div class="github-error">{ghInfo.error}</div>
							{/if}
							<div class="github-stats">
								<div class="github-stat-row">
									<span class="github-stat-label">REPO</span>
									<a href={`https://github.com/${project.githubRepo}`} target="_blank" rel="noopener noreferrer">
										{project.githubRepo}
									</a>
								</div>
								{#if ghInfo && !ghInfo.error}
									{#if ghInfo.description}
										<div class="github-stat-row">
											<span class="github-stat-label">ABOUT</span>
											<span>{ghInfo.description}</span>
										</div>
									{/if}
									<div class="github-stat-row">
										<span class="github-stat-label">BRANCH</span>
										<span>{ghInfo.defaultBranch}</span>
									</div>
									{#if ghInfo.lastPushedAt}
										<div class="github-stat-row">
											<span class="github-stat-label">PUSHED</span>
											<span>{formatRelativeTime(ghInfo.lastPushedAt)}</span>
										</div>
									{/if}
									<div class="github-stat-row">
										<span class="github-stat-label">STARS</span>
										<span>{ghInfo.stars}</span>
									</div>
									<div class="github-stat-row">
										<span class="github-stat-label">ISSUES</span>
										<span>{ghInfo.openIssueCount} open</span>
									</div>
									{#if ghInfo.lastMergedPr}
										<div class="github-stat-row">
											<span class="github-stat-label">LAST PR</span>
											<a href={ghInfo.lastMergedPr.url} target="_blank" rel="noopener noreferrer">
												#{ghInfo.lastMergedPr.number} {ghInfo.lastMergedPr.title}
											</a>
										</div>
									{/if}
									<div class="github-stat-row">
										<span class="github-stat-label">CACHED</span>
										<span>{formatRelativeTime(ghInfo.fetchedAt)}</span>
									</div>
									<div class="github-stat-row">
										<span class="github-stat-label">README</span>
										<span class="github-readme-actions">
											{#if ghInfo.readmeUpdatedAt}
												updated {formatRelativeTime(ghInfo.readmeUpdatedAt)} ·
											{:else if ghInfo.readmeFetchedAt}
												synced {formatRelativeTime(ghInfo.readmeFetchedAt)} ·
											{:else}
												not synced yet ·
											{/if}
											<form method="POST" action="?/syncReadme" use:enhance style="display:inline">
												<input type="hidden" name="projectId" value={project.id} />
												<button type="submit">sync</button>
											</form>
											{#if ghInfo.readmeContent}
												· <button type="button" onclick={() => {
													const blob = new Blob([ghInfo!.readmeContent!], { type: 'text/markdown' });
													const url = URL.createObjectURL(blob);
													const a = document.createElement('a');
													a.href = url;
													a.download = `${project.githubRepo?.split('/')[1] ?? 'readme'}.md`;
													a.click();
													URL.revokeObjectURL(url);
												}}>download</button>
												· <button type="button" onclick={() => {
													navigator.clipboard.writeText(ghInfo!.readmeContent!);
												}}>copy</button>
											{/if}
										</span>
									</div>
								{/if}
							</div>
							<div class="github-actions">
								<form method="POST" action="?/syncGithub" use:enhance>
									<input type="hidden" name="projectId" value={project.id} />
									<button type="submit">SYNC</button>
								</form>
								<form method="POST" action="?/unlinkGithub" use:enhance>
									<input type="hidden" name="projectId" value={project.id} />
									<button type="submit" class="btn-danger">UNLINK</button>
								</form>
							</div>
						</div>
					{/if}
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
