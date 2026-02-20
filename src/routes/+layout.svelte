<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>TIFF</title>
</svelte:head>

{@render children()}
