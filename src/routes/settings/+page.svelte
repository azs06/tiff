<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import type { PageData } from './$types';
	import { THEMES } from '$lib/types';
	import type { Theme } from '$lib/types';

	let { data }: { data: PageData } = $props();

	let theme = $state<Theme>('signal');
	let themeFormEl: HTMLFormElement;

	$effect(() => {
		theme = data.settings.theme;
	});

	$effect(() => {
		localStorage.setItem('tiff-theme', theme);
		document.documentElement.setAttribute('data-theme', theme);
	});

	async function setTheme(t: Theme) {
		theme = t;
		await tick();
		themeFormEl?.requestSubmit();
	}
</script>

<form
	method="POST"
	action="?/saveTheme"
	use:enhance={() => {
		return async ({ update }) => {
			await update({ reset: false, invalidateAll: true });
		};
	}}
	bind:this={themeFormEl}
	hidden
>
	<input type="hidden" name="theme" value={theme} />
</form>

<main class="main-content view-main">
	<header class="main-header view-header">
		<span class="tagline">Settings</span>
	</header>

	<section class="view-page" data-label="THEME">
		<div class="theme-switcher settings-theme-switcher">
			{#each THEMES as t (t)}
				<button class="theme-btn" class:active={theme === t} onclick={() => setTheme(t)}>{t.toUpperCase()}</button>
			{/each}
		</div>
	</section>
</main>
