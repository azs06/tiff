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
	let batchUsers = $state(50);
	let selectedEmail = $state('');
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

	function formatDateTime(ms: number | null): string {
		if (!ms) return 'N/A';
		return new Date(ms).toLocaleString();
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

	<section class="view-page" data-label="DATA MIGRATION">
		<form
			method="POST"
			action="?/runBackfill"
			class="detail-form settings-page-form"
			use:enhance={() => {
				return async ({ update }) => {
					await update({ reset: false, invalidateAll: true });
				};
			}}
		>
			<input type="hidden" name="runId" value={data.migrationStatus.runId ?? ''} />
			<div class="settings-field">
				<label class="settings-label" for="selectedEmail">User</label>
				<select class="settings-input" id="selectedEmail" name="selectedEmail" bind:value={selectedEmail}>
					<option value="">ALL USERS</option>
					{#each data.kvUsers as email}
						<option value={email}>{email}</option>
					{/each}
				</select>
			</div>
			<div class="settings-field">
				<label class="settings-label" for="batchUsers">Batch size</label>
				<input class="settings-input" type="number" id="batchUsers" name="batchUsers" min="1" max="500" bind:value={batchUsers} disabled={!!selectedEmail} />
			</div>
			<button type="submit" class="btn-save" disabled={!data.migrationStatus.enabled}>MIGRATE DATA</button>
			{#if !data.migrationStatus.enabled}
				<div class="settings-hint">Migration disabled. Configure D1, KV, and MIGRATION_ADMIN_TOKEN.</div>
			{/if}
		</form>

		{#if data.migrationStatus.status === 'running' && data.migrationStatus.runId}
			<form
				method="POST"
				action="?/cancelBackfill"
				class="detail-form settings-page-form"
				use:enhance={() => {
					return async ({ update }) => {
						await update({ reset: false, invalidateAll: true });
					};
				}}
			>
				<input type="hidden" name="runId" value={data.migrationStatus.runId} />
				<button type="submit" class="btn-save btn-danger">CANCEL MIGRATION</button>
			</form>
		{/if}

		<div class="migration-status-card">
			<div class="migration-status-row">
				<span class="settings-label">Run status</span>
				<span class="migration-status-value">{data.migrationStatus.status.toUpperCase()}</span>
			</div>
			<div class="migration-status-row">
				<span class="settings-label">Run ID</span>
				<span class="migration-status-value migration-run-id">{data.migrationStatus.runId ?? 'N/A'}</span>
			</div>
			<div class="migration-status-row">
				<span class="settings-label">Progress</span>
				<span class="migration-status-value">{data.migrationStatus.processedUsers} / {data.migrationStatus.totalUsers} USERS</span>
			</div>
			{#if data.migrationStatus.totalUsers > 0}
				<div class="migration-progress-bar">
					<div
						class="migration-progress-fill"
						class:migration-progress-complete={data.migrationStatus.status === 'completed'}
						class:migration-progress-failed={data.migrationStatus.status === 'failed' || data.migrationStatus.status === 'cancelled'}
						style="width: {Math.min(100, Math.round((data.migrationStatus.processedUsers / data.migrationStatus.totalUsers) * 100))}%"
					></div>
				</div>
			{/if}
			<div class="migration-status-row">
				<span class="settings-label">Mismatched users</span>
				<span class="migration-status-value">{data.migrationStatus.mismatchedUsers}</span>
			</div>
			<div class="migration-status-row">
				<span class="settings-label">Started</span>
				<span class="migration-status-value">{formatDateTime(data.migrationStatus.startedAt)}</span>
			</div>
			<div class="migration-status-row">
				<span class="settings-label">Finished</span>
				<span class="migration-status-value">{formatDateTime(data.migrationStatus.finishedAt)}</span>
			</div>
			{#if data.migrationStatus.notes}
				<div class="settings-hint migration-notes">{data.migrationStatus.notes}</div>
			{/if}
		</div>
	</section>
</main>
