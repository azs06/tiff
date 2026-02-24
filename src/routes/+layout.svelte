<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutData } from './$types';
	import { THEMES, type Theme } from '$lib/types';
	import '../app.css';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
	let leftSidebarOpen = $state(true);
	let sidebarPrefHydrated = false;

	const SIDEBAR_PREF_KEY = 'tiff-left-sidebar-open';

	function isActive(pathname: string, href: string): boolean {
		return href === '/' ? pathname === '/' : pathname.startsWith(href);
	}

	function toggleLeftSidebar() {
		leftSidebarOpen = !leftSidebarOpen;
	}

	function resolveTheme(): Theme {
		const stored = localStorage.getItem('tiff-theme');
		if (stored && THEMES.includes(stored as Theme)) return stored as Theme;
		return data.settings.theme;
	}

	$effect(() => {
		if (sidebarPrefHydrated) return;
		sidebarPrefHydrated = true;
		const stored = localStorage.getItem(SIDEBAR_PREF_KEY);
		if (stored === '0') leftSidebarOpen = false;
	});

	$effect(() => {
		const nextTheme = resolveTheme();
		document.documentElement.setAttribute('data-theme', nextTheme);
		localStorage.setItem('tiff-theme', nextTheme);
	});

	$effect(() => {
		if (!sidebarPrefHydrated) return;
		localStorage.setItem(SIDEBAR_PREF_KEY, leftSidebarOpen ? '1' : '0');
	});
</script>

<svelte:head>
	<title>TIFF</title>
</svelte:head>

<div class="app-shell" class:left-sidebar-collapsed={!leftSidebarOpen}>
	<aside class="left-sidebar">
		<div class="sidebar-header">
			<h1><a href="/">TIFF</a></h1>
		</div>
		<nav class="left-nav" aria-label="Main navigation">
			<a class="sidebar-tab" class:active={isActive(page.url.pathname, '/')} href="/">HOME</a>
			<a class="sidebar-tab" class:active={isActive(page.url.pathname, '/inbox')} href="/inbox">INBOX</a>
			<a class="sidebar-tab" class:active={isActive(page.url.pathname, '/projects')} href="/projects">PROJECTS</a>
			<a class="sidebar-tab" class:active={isActive(page.url.pathname, '/settings')} href="/settings">SETTINGS</a>
			<a class="sidebar-tab" class:active={isActive(page.url.pathname, '/archive')} href="/archive">ARCHIVE</a>
			<a class="sidebar-tab" class:active={isActive(page.url.pathname, '/calendar')} href="/calendar">ACTIVITY</a>
		</nav>
	</aside>

	<div class="content-shell">
		<button
			type="button"
			class="left-sidebar-arrow"
			class:collapsed={!leftSidebarOpen}
			onclick={toggleLeftSidebar}
			aria-label={leftSidebarOpen ? 'Hide navigation sidebar' : 'Show navigation sidebar'}
			aria-expanded={leftSidebarOpen}
		>
			<span class="left-sidebar-arrow-icon" aria-hidden="true"></span>
		</button>
		{@render children()}
	</div>
</div>
