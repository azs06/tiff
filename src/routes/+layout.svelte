<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutData } from './$types';
	import { THEMES, type Theme } from '$lib/types';
	import '../app.css';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	function isActive(pathname: string, href: string): boolean {
		return href === '/' ? pathname === '/' : pathname.startsWith(href);
	}

	function resolveTheme(): Theme {
		const stored = localStorage.getItem('tiff-theme');
		if (stored && THEMES.includes(stored as Theme)) return stored as Theme;
		return data.settings.theme;
	}

	$effect(() => {
		const nextTheme = resolveTheme();
		document.documentElement.setAttribute('data-theme', nextTheme);
		localStorage.setItem('tiff-theme', nextTheme);
	});
</script>

<svelte:head>
	<title>TIFF</title>
</svelte:head>

<div class="app-shell">
	<aside class="left-sidebar">
		<div class="sidebar-header">
			<h1><a href="/">TIFF</a></h1>
		</div>
		<nav class="left-nav" aria-label="Main navigation">
			<a class="sidebar-tab" class:active={isActive(page.url.pathname, '/')} href="/">HOME</a>
			<a class="sidebar-tab" class:active={isActive(page.url.pathname, '/projects')} href="/projects">PROJECTS</a>
			<a class="sidebar-tab" class:active={isActive(page.url.pathname, '/settings')} href="/settings">SETTINGS</a>
			<a class="sidebar-tab" class:active={isActive(page.url.pathname, '/archive')} href="/archive">ARCHIVE</a>
			<a class="sidebar-tab" class:active={isActive(page.url.pathname, '/calendar')} href="/calendar">CALENDAR</a>
		</nav>
	</aside>

	<div class="content-shell">
		{@render children()}
	</div>
</div>
