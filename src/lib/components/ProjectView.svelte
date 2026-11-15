<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';
	import {
		PROJECT_COLORS,
		PROJECT_COLOR_NAMES,
		type ProjectDetail,
		type ProjectSummary,
		type Task,
		type User
	} from '$lib/types';
	import { enhanced, formatBytes, initials } from '$lib/ui';
	import Icon from './Icon.svelte';
	import QuickAdd from './QuickAdd.svelte';
	import TaskList from './TaskList.svelte';

	let {
		project,
		tasks,
		showCompleted,
		projects,
		today,
		user
	}: {
		project: ProjectDetail;
		tasks: Task[];
		showCompleted: boolean;
		projects: ProjectSummary[];
		today: string;
		user: User;
	} = $props();

	let panelOpen = $state(false);
	let addingSection = $state(false);
	let renamingSection = $state<string | null>(null);

	const isOwner = $derived(project.role === 'owner');
	const archived = $derived(Boolean(project.archivedAt));
	const groups = $derived([
		{ id: null as string | null, name: null as string | null, tasks: tasks.filter((t) => !t.sectionId) },
		...project.sections.map((s) => ({ id: s.id as string | null, name: s.name as string | null, tasks: tasks.filter((t) => t.sectionId === s.id) }))
	]);
	const completedHref = $derived.by(() => {
		const params = new URLSearchParams(page.url.searchParams);
		if (showCompleted) params.delete('completed');
		else params.set('completed', '1');
		const query = params.toString();
		return `${page.url.pathname}${query ? `?${query}` : ''}`;
	});

	function confirmSubmit(message: string): SubmitFunction {
		const submit = enhanced();
		return (input) => {
			if (!confirm(message)) return input.cancel();
			return submit(input);
		};
	}
</script>

<header class="view-header">
	<div class="view-title">
		{#if project.isInbox}
			<Icon name="inbox" size={22} />
		{:else}
			<span class="dot large" style:background={PROJECT_COLORS[project.color]}></span>
		{/if}
		<h1>{project.name}</h1>
		{#if project.memberCount > 1}
			<span class="shared-badge" title="Shared project"><Icon name="users" size={14} />{project.memberCount}</span>
		{/if}
	</div>
	<div class="view-actions">
		<a class="btn ghost" href={completedHref} data-sveltekit-noscroll>
			<Icon name="completed" size={16} />{showCompleted ? 'Hide completed' : 'Show completed'}
		</a>
		<button class="btn ghost" onclick={() => (panelOpen = !panelOpen)} aria-expanded={panelOpen}>
			<Icon name={project.isInbox ? 'settings' : 'users'} size={16} />{project.isInbox ? 'Details' : 'Share & details'}
		</button>
	</div>
</header>

{#if archived}
	<div class="banner">
		This project is archived.
		{#if isOwner}
			<form method="POST" action="?/unarchiveProject" use:enhance={enhanced()}>
				<input type="hidden" name="projectId" value={project.id} />
				<button class="btn">Unarchive</button>
			</form>
		{/if}
	</div>
{/if}

{#if panelOpen}
	<section class="project-panel">
		{#if !project.isInbox}
			<form class="panel-block" method="POST" action="?/updateProject" use:enhance={enhanced()}>
				<input type="hidden" name="projectId" value={project.id} />
				<h3>Project</h3>
				<div class="row">
					<input name="name" value={project.name} maxlength="120" required aria-label="Project name" />
					<select name="color" value={project.color} aria-label="Color">
						{#each PROJECT_COLOR_NAMES as color (color)}
							<option value={color}>{color}</option>
						{/each}
					</select>
				</div>
				<textarea name="notes" rows="3" placeholder="Project notes" value={project.notes ?? ''}></textarea>
				<button class="btn" disabled={archived}>Save</button>
			</form>
		{:else}
			<form class="panel-block" method="POST" action="?/updateProject" use:enhance={enhanced()}>
				<input type="hidden" name="projectId" value={project.id} />
				<h3>Notes</h3>
				<textarea name="notes" rows="3" placeholder="Inbox notes" value={project.notes ?? ''}></textarea>
				<button class="btn">Save</button>
			</form>
		{/if}

		{#if !project.isInbox}
			<div class="panel-block">
				<h3>Members</h3>
				<ul class="members">
					{#each project.members as member (member.email)}
						<li>
							<span class="avatar">{initials(member.email)}</span>
							<span class="member-email">{member.email}{member.email === user.email ? ' (you)' : ''}</span>
							<span class="role">{member.role}</span>
							{#if member.role !== 'owner' && (isOwner || member.email === user.email)}
								<form
									method="POST"
									action="?/removeMember"
									use:enhance={confirmSubmit(
										member.email === user.email ? `Leave "${project.name}"?` : `Remove ${member.email}?`
									)}
								>
									<input type="hidden" name="projectId" value={project.id} />
									<input type="hidden" name="email" value={member.email} />
									<button class="link-btn danger">{member.email === user.email ? 'Leave' : 'Remove'}</button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
				{#if isOwner}
					<form class="row" method="POST" action="?/addMember" use:enhance={enhanced({ reset: true })}>
						<input type="hidden" name="projectId" value={project.id} />
						<input type="email" name="email" placeholder="person@example.com" required aria-label="Email to share with" />
						<button class="btn">Share</button>
					</form>
					<p class="hint">
						People sign in with Cloudflare Access using this email. Make sure your Access policy allows them.
					</p>
				{/if}
			</div>
		{/if}

		<div class="panel-block">
			<h3>Files</h3>
			<ul class="attachments">
				{#each project.attachments as file (file.id)}
					<li>
						<Icon name="paperclip" size={14} />
						<a href={`/attachments/${file.id}`} target="_blank" rel="noopener">{file.name}</a>
						<span class="muted">{formatBytes(file.size)}</span>
						<form method="POST" action="?/deleteAttachment" use:enhance={confirmSubmit(`Delete ${file.name}?`)}>
							<input type="hidden" name="attachmentId" value={file.id} />
							<button class="link-btn danger" disabled={archived}>Delete</button>
						</form>
					</li>
				{:else}
					<li class="muted">No files yet.</li>
				{/each}
			</ul>
			<form
				class="row"
				method="POST"
				action="?/uploadAttachment"
				enctype="multipart/form-data"
				use:enhance={enhanced({ reset: true })}
			>
				<input type="hidden" name="projectId" value={project.id} />
				<input type="file" name="file" required aria-label="File to upload" />
				<button class="btn" disabled={archived}>Upload</button>
			</form>
		</div>

		{#if isOwner && !project.isInbox}
			<div class="panel-block danger-zone">
				{#if !archived}
					<form method="POST" action="?/archiveProject" use:enhance={enhanced()}>
						<input type="hidden" name="projectId" value={project.id} />
						<button class="btn"><Icon name="archive" size={15} />Archive</button>
					</form>
				{/if}
				<form
					method="POST"
					action="?/deleteProject"
					use:enhance={confirmSubmit(`Delete "${project.name}" and all of its tasks for every member? This cannot be undone.`)}
				>
					<input type="hidden" name="projectId" value={project.id} />
					<button class="btn danger-outline"><Icon name="trash" size={15} />Delete project</button>
				</form>
			</div>
		{/if}
	</section>
{/if}

{#each groups as group (group.id ?? 'none')}
	{#if group.id || group.tasks.length || !archived}
		<section class="task-group">
			{#if group.id}
				<header class="group-header">
					{#if renamingSection === group.id}
						<form
							class="row"
							method="POST"
							action="?/renameSection"
							use:enhance={enhanced({ onSuccess: () => (renamingSection = null) })}
						>
							<input type="hidden" name="sectionId" value={group.id} />
							<input name="name" value={group.name} maxlength="120" required aria-label="Section name" />
							<button class="btn">Save</button>
							<button type="button" class="btn ghost" onclick={() => (renamingSection = null)}>Cancel</button>
						</form>
					{:else}
						{@const open = group.tasks.filter((t) => !t.completedAt && !t.parentId).length}
						<h2>{group.name} {#if open}<span class="count">{open}</span>{/if}</h2>
						{#if !archived}
							<div class="group-actions">
								<button class="link-btn" onclick={() => (renamingSection = group.id)}>Rename</button>
								<form
									method="POST"
									action="?/deleteSection"
									use:enhance={confirmSubmit(`Delete section "${group.name}"? Its tasks stay in the project.`)}
								>
									<input type="hidden" name="sectionId" value={group.id} />
									<button class="link-btn danger">Delete</button>
								</form>
							</div>
						{/if}
					{/if}
				</header>
			{/if}
			<TaskList
				tasks={group.tasks}
				{today}
				nest
				reorder={archived ? null : { projectId: project.id, sectionId: group.id }}
			/>
			{#if !archived}
				<QuickAdd {projects} {today} projectId={project.id} sectionId={group.id} />
			{/if}
		</section>
	{/if}
{/each}

{#if !archived}
	{#if addingSection}
		<form
			class="row section-form"
			method="POST"
			action="?/createSection"
			use:enhance={enhanced({ reset: true, onSuccess: () => (addingSection = false) })}
		>
			<input type="hidden" name="projectId" value={project.id} />
			<!-- svelte-ignore a11y_autofocus -->
			<input name="name" placeholder="Section name" maxlength="120" required autofocus aria-label="Section name" />
			<button class="btn primary">Add section</button>
			<button type="button" class="btn ghost" onclick={() => (addingSection = false)}>Cancel</button>
		</form>
	{:else}
		<button class="add-section" onclick={() => (addingSection = true)}><span>Add section</span></button>
	{/if}
{/if}

{#if tasks.length === 0 && project.sections.length === 0}
	<div class="empty-state">
		<p>{project.isInbox ? 'Your Inbox is empty. Capture anything here.' : 'No tasks yet.'}</p>
		<p class="hint">Try: <code>Call mom tomorrow 6pm p1 @phone</code></p>
	</div>
{/if}
