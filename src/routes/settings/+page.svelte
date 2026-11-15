<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import { THEMES } from '$lib/types';
	import { enhanced, relativeTime } from '$lib/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let newToken = $state<string | null>(null);
	let copied = $state<string | null>(null);

	const timeZones = $derived.by(() => {
		const zones: string[] =
			typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
		return zones.includes(data.user.timezone) ? zones : [data.user.timezone, ...zones];
	});

	const tokenForSnippet = $derived(newToken ?? '<your token>');
	const claudeCommand = $derived(
		`claude mcp add --transport http tiff ${data.mcpUrl} --header "Authorization: Bearer ${tokenForSnippet}"`
	);
	const jsonConfig = $derived(
		JSON.stringify(
			{ mcpServers: { tiff: { url: data.mcpUrl, headers: { Authorization: `Bearer ${tokenForSnippet}` } } } },
			null,
			2
		)
	);

	async function copy(text: string, key: string) {
		await navigator.clipboard.writeText(text);
		copied = key;
		setTimeout(() => (copied = copied === key ? null : copied), 1500);
	}

	function submitOnChange(event: Event) {
		(event.currentTarget as HTMLFormElement).requestSubmit();
	}
</script>

<svelte:head><title>Settings · TIFF</title></svelte:head>

<header class="view-header">
	<div class="view-title">
		<Icon name="settings" size={22} />
		<h1>Settings</h1>
	</div>
</header>

<section class="settings-block">
	<h2>Appearance</h2>
	<form method="POST" action="?/saveSettings" use:enhance={enhanced()} onchange={submitOnChange}>
		<div class="theme-options">
			{#each THEMES as theme (theme)}
				<label class="theme-option" data-theme-preview={theme}>
					<input type="radio" name="theme" value={theme} checked={data.user.theme === theme} />
					<span>{theme}</span>
				</label>
			{/each}
		</div>
	</form>
</section>

<section class="settings-block">
	<h2>Time zone</h2>
	<p class="hint">Used for Today, overdue tasks and recurring dates. Currently {data.today} in {data.user.timezone}.</p>
	<form method="POST" action="?/saveSettings" use:enhance={enhanced()} onchange={submitOnChange}>
		<select name="timezone" value={data.user.timezone} aria-label="Time zone">
			{#each timeZones as zone (zone)}
				<option value={zone}>{zone}</option>
			{/each}
		</select>
	</form>
</section>

<section class="settings-block">
	<h2>API tokens &amp; MCP</h2>
	<p class="hint">
		Connect AI assistants such as Claude Code or Cursor through the MCP endpoint
		<code>{data.mcpUrl}</code>. Each token acts as you and can read and change everything you can.
	</p>

	<form
		class="row"
		method="POST"
		action="?/createToken"
		use:enhance={enhanced({
			reset: true,
			onSuccess: (result) => (newToken = typeof result?.token === 'string' ? result.token : null)
		})}
	>
		<input name="name" placeholder="Token name, e.g. Claude Code laptop" maxlength="80" required aria-label="Token name" />
		<button class="btn primary"><Icon name="key" size={15} />Create token</button>
	</form>

	{#if newToken}
		<div class="token-reveal">
			<p><strong>Copy this token now.</strong> It will not be shown again.</p>
			<div class="row">
				<code class="token">{newToken}</code>
				<button class="btn" onclick={() => copy(newToken!, 'token')}>{copied === 'token' ? 'Copied' : 'Copy'}</button>
			</div>
		</div>
	{/if}

	<ul class="token-list">
		{#each data.tokens as token (token.id)}
			<li>
				<Icon name="key" size={15} />
				<span class="token-name">{token.name}</span>
				<code>{token.prefix}…</code>
				<span class="muted">
					created {relativeTime(token.createdAt)} · {token.lastUsedAt ? `used ${relativeTime(token.lastUsedAt)}` : 'never used'}
				</span>
				<form
					method="POST"
					action="?/revokeToken"
					use:enhance={(input) => {
						if (!confirm(`Revoke "${token.name}"? Clients using it will stop working.`)) return input.cancel();
						return enhanced()(input);
					}}
				>
					<input type="hidden" name="tokenId" value={token.id} />
					<button class="link-btn danger">Revoke</button>
				</form>
			</li>
		{:else}
			<li class="muted">No active tokens.</li>
		{/each}
	</ul>

	<h3>Claude Code</h3>
	<div class="snippet">
		<pre>{claudeCommand}</pre>
		<button class="btn ghost" onclick={() => copy(claudeCommand, 'claude')}>{copied === 'claude' ? 'Copied' : 'Copy'}</button>
	</div>

	<h3>Other MCP clients (Cursor, VS Code, …)</h3>
	<div class="snippet">
		<pre>{jsonConfig}</pre>
		<button class="btn ghost" onclick={() => copy(jsonConfig, 'json')}>{copied === 'json' ? 'Copied' : 'Copy'}</button>
	</div>
</section>
