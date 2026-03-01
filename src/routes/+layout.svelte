<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutData } from './$types';
	import { THEMES, type Theme } from '$lib/types';
	import '../app.css';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();
	let leftSidebarOpen = $state(true);
	let sidebarPrefHydrated = false;
	let leftSidebarEl: HTMLElement | null = null;
	let mobileSidebarOffset = $state(0);

	const SIDEBAR_PREF_KEY = 'tiff-left-sidebar-open';

	function isActive(pathname: string, href: string): boolean {
		return href === '/' ? pathname === '/' : pathname.startsWith(href);
	}

	function toggleLeftSidebar() {
		leftSidebarOpen = !leftSidebarOpen;
	}

	function updateMobileSidebarOffset() {
		mobileSidebarOffset = leftSidebarEl?.offsetHeight ?? 0;
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

	$effect(() => {
		if (!leftSidebarEl) return;
		updateMobileSidebarOffset();
		const observer = new ResizeObserver(updateMobileSidebarOffset);
		observer.observe(leftSidebarEl);
		window.addEventListener('resize', updateMobileSidebarOffset, { passive: true });
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', updateMobileSidebarOffset);
		};
	});

	/* Hide the mobile bottom nav when the virtual keyboard is open */
	$effect(() => {
		const vv = window.visualViewport;
		if (!vv || !leftSidebarEl) return;

		const onViewportResize = () => {
			const keyboardOpen = window.innerHeight - vv.height > 150;
			leftSidebarEl?.classList.toggle('keyboard-open', keyboardOpen);
		};

		vv.addEventListener('resize', onViewportResize, { passive: true });
		return () => vv.removeEventListener('resize', onViewportResize);
	});
</script>

<svelte:head>
	<title>TIFF</title>
</svelte:head>

<div
	class="app-shell"
	class:left-sidebar-collapsed={!leftSidebarOpen}
	style={`--mobile-left-sidebar-offset: ${mobileSidebarOffset}px;`}
>
	<aside class="left-sidebar" bind:this={leftSidebarEl}>
		<div class="sidebar-header">
			<h1><a href="/">TIFF</a></h1>
		</div>
		<nav class="left-nav" aria-label="Main navigation">
			<a
				class="sidebar-tab"
				class:active={isActive(page.url.pathname, '/')}
				href="/"
				aria-label="Home"
			>
				<span class="tab-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24">
						<path d="M3 10.5 12 3l9 7.5" />
						<path d="M5 9.75V21h5.5v-6h3V21H19V9.75" />
					</svg>
				</span>
				<span class="tab-label">HOME</span>
			</a>
			<a
				class="sidebar-tab"
				class:active={isActive(page.url.pathname, '/inbox')}
				href="/inbox"
				aria-label="Inbox"
			>
				<span class="tab-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24">
						<path d="M3.5 5.5h17v11h-4.5l-2 3h-4l-2-3H3.5z" />
						<path d="M3.5 13.5h5l1.5 2h4l1.5-2h5" />
					</svg>
				</span>
				<span class="tab-label">INBOX</span>
			</a>
			<a
				class="sidebar-tab"
				class:active={isActive(page.url.pathname, '/projects')}
				href="/projects"
				aria-label="Projects"
			>
				<span class="tab-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24">
						<path d="M3.5 7.5h6l2 2h9v9.5H3.5z" />
						<path d="M3.5 7.5V5.5h6l2 2" />
					</svg>
				</span>
				<span class="tab-label">PROJECTS</span>
			</a>
			<a
				class="sidebar-tab"
				class:active={isActive(page.url.pathname, '/settings')}
				href="/settings"
				aria-label="Settings"
			>
				<span class="tab-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24">
						<path d="M4 6h3" />
						<path d="M11 6h9" />
						<circle cx="9" cy="6" r="2" />
						<path d="M4 12h8" />
						<path d="M16 12h4" />
						<circle cx="14" cy="12" r="2" />
						<path d="M4 18h11" />
						<path d="M19 18h1" />
						<circle cx="17" cy="18" r="2" />
					</svg>
				</span>
				<span class="tab-label">SETTINGS</span>
			</a>
			<a
				class="sidebar-tab"
				class:active={isActive(page.url.pathname, '/archive')}
				href="/archive"
				aria-label="Archive"
			>
				<span class="tab-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24">
						<path d="M4 4.5h16v4H4z" />
						<path d="M5 8.5h14V20H5z" />
						<path d="M10 12h4" />
					</svg>
				</span>
				<span class="tab-label">ARCHIVE</span>
			</a>
			<a
				class="sidebar-tab"
				class:active={isActive(page.url.pathname, '/calendar')}
				href="/calendar"
				aria-label="Activity"
			>
				<span class="tab-icon" aria-hidden="true">
					<svg viewBox="0 0 24 24">
						<rect x="4" y="5" width="16" height="15" rx="1.5" />
						<path d="M4 9h16" />
						<path d="M8 3.5v3" />
						<path d="M16 3.5v3" />
						<path d="M8 13h3" />
						<path d="M13 13h3" />
						<path d="M8 17h3" />
					</svg>
				</span>
				<span class="tab-label">ACTIVITY</span>
			</a>
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
