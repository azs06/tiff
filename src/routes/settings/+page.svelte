<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import type { PageData } from './$types';
	import { THEMES } from '$lib/types';
	import type { Theme } from '$lib/types';

	let { data }: { data: PageData } = $props();

	let workMin = $state(0);
	let shortBreakMin = $state(0);
	let longBreakMin = $state(0);
	let theme = $state<Theme>('signal');
	let themeFormEl: HTMLFormElement;

	$effect(() => {
		workMin = Math.round(data.settings.workMs / 60000);
		shortBreakMin = Math.round(data.settings.shortBreakMs / 60000);
		longBreakMin = Math.round(data.settings.longBreakMs / 60000);
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

	<section class="view-page" data-label="POMODORO">
		<form
			method="POST"
			action="?/saveSettings"
			class="detail-form settings-page-form"
			use:enhance={() => {
				return async ({ update }) => {
					await update({ reset: false });
				};
			}}
		>
			<div class="settings-field">
				<label class="settings-label" for="work">Work (minutes)</label>
				<input class="settings-input" type="number" id="work" name="work" min="1" max="120" bind:value={workMin} />
			</div>
			<div class="settings-field">
				<label class="settings-label" for="shortBreak">Short break (minutes)</label>
				<input class="settings-input" type="number" id="shortBreak" name="shortBreak" min="1" max="120" bind:value={shortBreakMin} />
			</div>
			<div class="settings-field">
				<label class="settings-label" for="longBreak">Long break (minutes)</label>
				<input class="settings-input" type="number" id="longBreak" name="longBreak" min="1" max="120" bind:value={longBreakMin} />
			</div>
			<div class="settings-hint">Long break triggers every 4 pomodoros</div>
			<button type="submit" class="btn-save">SAVE SETTINGS</button>
		</form>
	</section>

	<section class="view-page" data-label="THEME">
		<div class="theme-switcher settings-theme-switcher">
			{#each THEMES as t}
				<button class="theme-btn" class:active={theme === t} onclick={() => setTheme(t)}>{t.toUpperCase()}</button>
			{/each}
		</div>
	</section>
</main>
