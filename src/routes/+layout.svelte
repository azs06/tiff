<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import QuickAdd from '$lib/components/QuickAdd.svelte';
	import TaskDetail from '$lib/components/TaskDetail.svelte';
	import { dismissToast, toasts } from '$lib/toast.svelte';
	import { PROJECT_COLORS } from '$lib/types';
	import { postAction } from '$lib/ui';
	import type { LayoutData } from './$types';
	import '../app.css';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	let sidebarOpen = $state(false);
	let quickAddOpen = $state(false);
	let searchInput: HTMLInputElement | null = $state(null);

	const nav: { href: string; label: string; icon: IconName; count?: number }[] = $derived([
		{ href: '/inbox', label: 'Inbox', icon: 'inbox', count: data.counts.inbox },
		{ href: '/today', label: 'Today', icon: 'today', count: data.counts.today },
		{ href: '/upcoming', label: 'Upcoming', icon: 'upcoming' },
		{ href: '/completed', label: 'Completed', icon: 'completed' }
	]);
	const otherProjects = $derived(data.projects.filter((p) => !p.isInbox));

	function isActive(href: string) {
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}

	// Apply the saved theme; localStorage lets app.html set it before first paint.
	$effect(() => {
		document.documentElement.setAttribute('data-theme', data.user.theme);
		localStorage.setItem('tiff-theme', data.user.theme);
	});

	// Adopt the browser's time zone the first time this browser sees an account still on UTC.
	$effect(() => {
		const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const key = `tiff-tz-synced:${data.user.email}`;
		if (data.user.timezone !== 'UTC' || !browserZone || browserZone === 'UTC' || localStorage.getItem(key)) return;
		localStorage.setItem(key, '1');
		void postAction('saveSettings', { timezone: browserZone });
	});

	// Close the mobile sidebar after navigating.
	$effect(() => {
		void page.url.pathname;
		sidebarOpen = false;
	});

	function isTyping(target: EventTarget | null) {
		const el = target as HTMLElement | null;
		return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)));
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
		if (event.key === 'q') {
			event.preventDefault();
			quickAddOpen = true;
		} else if (event.key === '/') {
			event.preventDefault();
			sidebarOpen = true;
			searchInput?.focus();
		}
	}

	function onSearch(event: SubmitEvent) {
		event.preventDefault();
		const q = new FormData(event.currentTarget as HTMLFormElement).get('q');
		goto(`/search?q=${encodeURIComponent(String(q ?? ''))}`);
	}
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:head>
	<title>TIFF</title>
</svelte:head>

<div class="app-shell" class:sidebar-open={sidebarOpen}>
	<aside class="sidebar">
		<div class="sidebar-top">
			<a class="brand" href="/today">TIFF</a>
			<button class="add-btn" onclick={() => (quickAddOpen = true)} title="Add task (Q)">
				<Icon name="plus" size={16} />Add task
			</button>
		</div>

		<form class="search" role="search" action="/search" onsubmit={onSearch}>
			<Icon name="search" size={15} />
			<input
				bind:this={searchInput}
				name="q"
				type="search"
				placeholder="Search"
				value={page.url.pathname === '/search' ? (page.url.searchParams.get('q') ?? '') : ''}
				aria-label="Search tasks"
			/>
		</form>

		<nav class="nav" aria-label="Views">
			{#each nav as item (item.href)}
				<a class="nav-item" class:active={isActive(item.href)} href={item.href}>
					<Icon name={item.icon} />
					<span class="nav-label">{item.label}</span>
					{#if item.count}<span class="nav-count">{item.count}</span>{/if}
				</a>
			{/each}
		</nav>

		<div class="nav-heading">
			<a href="/projects">Projects</a>
			<a class="icon-btn small" href="/projects#new" aria-label="New project"><Icon name="plus" size={15} /></a>
		</div>
		<nav class="nav" aria-label="Projects">
			{#each otherProjects as project (project.id)}
				<a class="nav-item" class:active={isActive(`/projects/${project.id}`)} href={`/projects/${project.id}`}>
					<span class="dot" style:background={PROJECT_COLORS[project.color]}></span>
					<span class="nav-label">{project.name}</span>
					{#if project.memberCount > 1}<span class="nav-shared"><Icon name="users" size={13} /></span>{/if}
					{#if project.openCount}<span class="nav-count">{project.openCount}</span>{/if}
				</a>
			{:else}
				<a class="nav-item muted" href="/projects#new">Create a project</a>
			{/each}
		</nav>

		{#if data.labels.length}
			<div class="nav-heading"><span>Labels</span></div>
			<nav class="nav" aria-label="Labels">
				{#each data.labels as label (label.name)}
					<a
						class="nav-item"
						class:active={isActive(`/labels/${encodeURIComponent(label.name)}`)}
						href={`/labels/${encodeURIComponent(label.name)}`}
					>
						<Icon name="tag" size={16} />
						<span class="nav-label">{label.name}</span>
						{#if label.openCount}<span class="nav-count">{label.openCount}</span>{/if}
					</a>
				{/each}
			</nav>
		{/if}

		<div class="sidebar-bottom">
			<a class="nav-item" class:active={isActive('/settings')} href="/settings">
				<Icon name="settings" />
				<span class="nav-label">Settings</span>
			</a>
			<span class="user-email" title={data.user.email}>{data.user.email}</span>
		</div>
	</aside>

	<button class="sidebar-scrim" onclick={() => (sidebarOpen = false)} aria-label="Close menu" tabindex="-1"></button>

	<div class="main">
		<header class="mobile-bar">
			<button class="icon-btn" onclick={() => (sidebarOpen = true)} aria-label="Open menu"><Icon name="menu" /></button>
			<a class="brand" href="/today">TIFF</a>
			<button class="icon-btn" onclick={() => (quickAddOpen = true)} aria-label="Add task"><Icon name="plus" /></button>
		</header>
		<main class="content">
			{@render children()}
		</main>
	</div>
</div>

{#if data.taskDetail}
	{#key data.taskDetail.task.id}
		<TaskDetail detail={data.taskDetail} projects={data.projects} today={data.today} user={data.user} />
	{/key}
{/if}

{#if quickAddOpen}
	<div class="modal-backdrop" onclick={() => (quickAddOpen = false)} role="presentation"></div>
	<div class="modal quick-add-modal" role="dialog" aria-modal="true" aria-label="Add task">
		<QuickAdd
			projects={data.projects}
			today={data.today}
			projectId={page.params.projectId ?? null}
			bind:open={quickAddOpen}
		/>
		<p class="hint syntax-hint">
			<code>#Project</code> <code>@label</code> <code>p1</code> <code>tomorrow 5pm</code> <code>every mon</code>
		</p>
	</div>
{/if}

<div class="toasts" aria-live="polite">
	{#each toasts as item (item.id)}
		<div class="toast" class:error={item.kind === 'error'}>
			<span>{item.message}</span>
			{#if item.action}
				<button
					class="link-btn"
					onclick={() => {
						item.action?.run();
						dismissToast(item.id);
					}}>{item.action.label}</button
				>
			{/if}
			<button class="icon-btn small" onclick={() => dismissToast(item.id)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
		</div>
	{/each}
</div>
